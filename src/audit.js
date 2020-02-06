/**
 * audit.js
 *
 * @module audit
 */

const fs = require("fs");
const pathModule = require("path");
const { format } = require("util");

const sysconfig = require("./sysconfig");
const { makeFullPluginId,
        PLUGIN_KINDS,
        loadPluginByKind,
        parseFullPluginId,
        isDefaultPlugin,
        lookupDefaultBuildPlugin,
        lookupDefaultDeployPlugin } = require("./plugin");
const { installPluginDirect } = require("./plugin/cache");
const { WebdeployError } = require("./error");

// Cache plugins that have been audited here. Plugins are keyed such that
// AUDITED_PLUGINS[KIND][ID] gets the plugin. The KIND is one of 'build' or
// 'deploy' and the ID is the fully-qualified plugin ID.
const AUDITED_PLUGINS = {
    build: {},
    deploy: {}
}

/**
 * @typedef pluginDescription
 * @type {object}
 * @property {string} pluginId The base ID for the plugin
 * @property {string} pluginVersion The version for the plugin
 * @property {string} pluginKind Either 'build' or 'deploy'
 * @property {object=} pluginObject Resolved plugin object
 */

/**
 * Adds an audited plugin to the internal set of audited plugins. This internal
 * set of plugins is shared among all PluginAuditor instances.
 *
 * @param {module:audit~pluginDescription} pluginInfo
 */
function addAuditedPlugin(pluginInfo) {
    var bucket;
    var pluginId = makeFullPluginId(pluginInfo);

    if (pluginInfo.pluginKind == PLUGIN_KINDS.BUILD_PLUGIN) {
        bucket = AUDITED_PLUGINS.build;
    }
    else {
        bucket = AUDITED_PLUGINS.deploy;
    }

    if (pluginId in bucket) {
        return bucket[pluginId];
    }

    var pluginObject = loadPluginByKind(pluginInfo,pluginInfo.pluginKind);
    bucket[pluginId] = pluginObject;

    return pluginObject;
}

/**
 * Audits plugins that are required for a given build/deploy run. A
 * PluginAuditor installs missing plugins in the per-user plugin cache.
 */
class PluginAuditor {
    /**
     * Creates a new PluginAuditor instance.
     */
    constructor() {
        this.orders = [];
        this.plugins = { build:{}, deploy:{} };
    }

    /**
     * Attaches a logger to the auditor. The auditor will write log messages to
     * this logger as it audits/installs plugins.
     *
     * @param Object logger
     */
    attachLogger(logger) {
        this.logger = logger;
    }

    /**
     * Logs a message to the attached logger. If no logger is attached, this
     * operation does nothing.
     */
    log(a) {
        if (this.logger) {
            this.logger.log(a);
        }
    }

    /**
     * Sets up the attached logger for logging.
     */
    beginLog() {
        if (this.logger) {
            this.logger.pushIndent();
        }
    }

    /**
     * Finalizes the attached logger after logging.
     */
    endLog() {
        if (this.logger) {
            this.logger.popIndent();
        }
    }

    /**
     * Adds an auditing order to the auditor.
     *
     * @param {module:audit~pluginDescription[]} plugins
     *   List of plugin descriptions denoting the plugins to load.
     * @param {module:audit~PluginAuditor~orderCallback} callback
     *  The callback that handles the resolution of the requested plugins.
     */
    addOrder(plugins,callback) {
        this.orders.push({
            plugins,
            callback
        })

        this.addPlugins(plugins);
    }

    /**
     * Adds plugins of a particular plugin kind to the auditor's internal list
     * of plugins to audit.
     *
     * @param {module:audit~pluginDescription[]} plugins
     *  List of plugin descriptions.
     */
    addPlugins(plugins) {
        for (let i = 0;i < plugins.length;++i) {
            var bucket;
            var plugin = plugins[i];
            var pluginId = makeFullPluginId(plugin,plugin);

            if (plugin.pluginKind == PLUGIN_KINDS.BUILD_PLUGIN) {
                bucket = this.plugins.build;
            }
            else {
                bucket = this.plugins.deploy;
            }

            if (pluginId in bucket) {
                continue;
            }

            bucket[pluginId] = plugin;
        }
    }

    /**
     * Ensures that the local environment can load the set of plugins previously
     * supplied.
     *
     * @param {module:audit~PluginAuditor~auditCallback} callback
     *  Invoked when the audit completes.
     */
    audit(callback) {
        const PLUGIN_DIRS = sysconfig.pluginDirectories;
        const orders = this.orders;

        var queue = Object.values(this.plugins.build).concat(Object.values(this.plugins.deploy));
        queue.pop = Array.prototype.shift;

        this.log("Auditing plugins");
        this.beginLog();

        var gotError = false;

        let donefn = (plugin) => {
            // Load the plugin and attach to loader info. Enqueue any required plugins here.
            plugin.pluginObject = addAuditedPlugin(plugin);
            if (plugin.pluginObject.requires) {
                var requires = plugin.pluginObject.requires;

                if (requires.build) {
                    for (let i = 0;i < requires.build.length;++i) {
                        var newPlugin = {
                            pluginKind: PLUGIN_KINDS.BUILD_PLUGIN
                        }

                        Object.assign(newPlugin,parseFullPluginId(requires.build[i]));
                        queue.push(newPlugin);
                    }
                }
                if (requires.deploy) {
                    for (let i = 0;i < requires.deploy.length;++i) {
                        var newPlugin = {
                            pluginKind: PLUGIN_KINDS.DEPLOY_PLUGIN
                        }

                        Object.assign(newPlugin,parseFullPluginId(requires.deploy[i]));
                        queue.push(newPlugin);
                    }
                }
            }

            // Resolve the promise if we are done. Otherwise continue processing.
            if (queue.length == 0) {
                // Resolve all orders by calling the callbacks.
                orders.forEach((order) => {
                    order.callback(order.plugins);
                })

                this.log("Done auditing plugins");
                this.endLog();

                callback();
            }
            else {
                nextfn();
            }
        }

        let errfn = (err) => {
            if (!gotError) {
                gotError = true;
                callback(err);
            }
        }

        let nextfn = () => {
            let pluginInfo = queue.pop();
            let index = 0;

            let { pluginId, pluginVersion } = pluginInfo;

            // Make fully-qualified plugin ID with version. Omit version if
            // latest; this allows us to maintain latest and versioned
            // separately.
            if (pluginVersion && pluginVersion != "latest") {
                pluginId = makeFullPluginId(pluginInfo);
            }

            if (isDefaultPlugin(pluginInfo)) {
                donefn(pluginInfo);
                return;
            }

            let completefn = () => {
                if (gotError) {
                    return;
                }

                if (index < PLUGIN_DIRS.length) {
                    let next = pathModule.join(PLUGIN_DIRS[index++],pluginId);

                    fs.stat(next, (err,stats) => {
                        if (!err && stats.isDirectory()) {
                            donefn(pluginInfo);
                        }
                        else {
                            completefn();
                        }
                    })
                }
                else {
                    if (!pluginInfo.pluginVersion) {
                        errfn(new WebdeployError(
                            format("Plugin '%s' must have a version constraint",pluginId)));
                    }
                    else {
                        installPluginDirect(pluginInfo,() => donefn(pluginInfo),errfn,this.logger);
                    }
                }
            }

            completefn();
        }

        nextfn();
    }
}

/**
 * Callback invoked when a load order has resolved in the auditor.
 * @callback module:audit~PluginAuditor~orderCallback
 * @param {module:audit~pluginDescription[]} plugins
 *  List of resolved plugin descriptions.
 */

/**
 * Callback invoked when an audit completes.
 * @callback module:audit~PluginAuditor~auditCallback
 * @param {object=} error
 *  If provided, then an error occurred and the audit failed.
 */

function lookupBuildPlugin(pluginInfo) {
    var plugin = lookupDefaultBuildPlugin(pluginInfo);
    if (!plugin) {
        var pluginId = makeFullPluginId(pluginInfo);
        if (!(pluginId in AUDITED_PLUGINS.build)) {
            throw new Error("Plugin '" + pluginId + "' was not in the set of audited plugins");
        }

        return AUDITED_PLUGINS.build[pluginId];
    }

    return plugin;
}

function lookupDeployPlugin(pluginInfo) {
    var plugin = lookupDefaultDeployPlugin(pluginInfo);
    if (!plugin) {
        var pluginId = makeFullPluginId(pluginInfo);
        if (!(pluginId in AUDITED_PLUGINS.deploy)) {
            throw new Error("Plugin '" + pluginId + "' was not in the set of audited plugins");
        }

        return AUDITED_PLUGINS.deploy[pluginId];
    }

    return plugin;
}

module.exports = {
    PluginAuditor,

    lookupBuildPlugin,
    lookupDeployPlugin
}

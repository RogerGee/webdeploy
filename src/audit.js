// audit.js

const fs = require("fs");
const pathModule = require("path");
const { format } = require("util");

const sysconfig = require("./sysconfig").config;
const pluginModule = require("./plugins");
const pluginCache = require("./plugin-cache");
const { WebdeployError } = require("./error");
const logger = require("./logger");

// Cache plugins that have been audited here. Plugins are keyed by their
// fully-qualified names.

const auditedPlugins = {}

function addAuditedPlugin(pluginInfo) {
    var pluginId = pluginModule.makeFullPluginId(pluginInfo);

    if (pluginId in auditedPlugins) {
        return auditedPlugins[pluginId];
    }

    var pluginObject = pluginModule.loadPluginByKind(pluginInfo,pluginInfo.pluginKind);

    auditedPlugins[pluginId] = pluginObject;

    return pluginObject;
}

/**
 * Audits plugins that are required for a given build/deploy run. A
 * PluginAuditor installs missing plugins in the per-user plugin cache.
 */
class PluginAuditor {
    constructor() {
        this.orders = [];
        this.plugins = {};
    }

    /**
     * Adds an auditing order to the auditor.
     *
     * @param Array plugins
     *   List of plugin loader objects denoting the plugins to load. Each object
     *   should be augmented with the 'pluginKind' as well (enumerated in
     *   plugins.PLUGIN_KINDS).
     * @param Function callback
     *  A callback to invoke with the loaded plugins. The callback is passed the
     *  same plugins array; each object in this array will have been updated to
     *  contain a 'pluginObject' property that contains the loaded plugin.
     */
    addOrder(plugins,callback) {
        this.orders.push({
            plugins,
            callback
        })

        this.addPlugins(plugins);
    }

    addPlugins(plugins,kind) {
        for (let i = 0;i < plugins.length;++i) {
            var plugin = plugins[i];
            var pluginId = pluginModule.makeFullPluginId(plugin,plugin);

            if (pluginId in this.plugins) {
                continue;
            }

            this.plugins[pluginId] = plugin;
        }
    }

    /**
     * Ensures that the local environment can load the set of plugins previously
     * supplied.
     *
     * @return Promise A Promise that resolves when all plugins have been audited.
     */
    audit() {
        const PLUGIN_DIRS = sysconfig.pluginDirectories;
        const orders = this.orders;

        var queue = Object.values(this.plugins);
        queue.pop = Array.prototype.shift;

        return new Promise((resolve,reject) => {
            var rejected = false;

            nextfn();

            function donefn(plugin) {
                // Load the plugin and attach to loader info. Enqueue any required plugins here.
                plugin.pluginObject = addAuditedPlugin(plugin);
                if (plugin.pluginObject.requires) {
                    var requires = plugin.pluginObject.requires;

                    if (requires.build) {
                        for (let i = 0;i < requires.build.length;++i) {
                            var newPlugin = {pluginKind: PLUGIN_KINDS.BUILD_PLUGIN};
                            Object.assign(newPlugin,requires.build[i]);
                            queue.push(newPlugin);
                        }
                    }
                    if (requires.deploy) {
                        for (let i = 0;i < requires.deploy.length;++i) {
                            var newPlugin = {pluginKind: PLUGIN_KINDS.DEPLOY_PLUGIN};
                            Object.assign(newPlugin,requires.deploy[i]);
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

                    resolve();
                }
                else {
                    nextfn();
                }
            }

            function errfn(err) {
                if (!rejected) {
                    rejected = true;
                    reject(err);
                }
            }

            function nextfn() {
                let pluginInfo = queue.pop();
                let index = 0;

                let { pluginId, pluginVersion } = pluginInfo;

                // Make fully-qualified plugin ID with version. Omit version if
                // latest; this allows us to maintain latest and versioned
                // separately.
                if (pluginVersion && pluginVersion != "latest") {
                    pluginId = pluginModule.makeFullPluginId(pluginInfo);
                }

                if (pluginModule.isDefaultPlugin(pluginInfo)) {
                    donefn(pluginInfo);
                    return;
                }

                function completefn() {
                    if (rejected) {
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
                            pluginCache.installPluginDirect(pluginInfo,() => donefn(pluginInfo),errfn);
                        }
                    }
                }

                completefn();
            }
        })
    }
}

function lookupAuditedPlugin(pluginInfo,kind) {
    var pluginId = pluginModule.makeFullPluginId(pluginInfo);
    if (!(pluginId in auditedPlugins)) {
        throw new Error("Plugin '" + pluginId + "' was not in the set of audited plugins");
    }

    return auditedPlugins[pluginId];
}

function lookupBuildPlugin(pluginInfo) {
    var plugin = pluginModule.lookupDefaultBuildPlugin(pluginInfo);
    if (!plugin) {
        plugin = lookupAuditedPlugin(pluginInfo,pluginModule.PLUGIN_KINDS.BUILD_PLUGIN);
    }

    return plugin;
}

function lookupDeployPlugin(pluginInfo) {
    var plugin = pluginModule.lookupDefaultDeployPlugin(pluginInfo);
    if (!plugin) {
        plugin = lookupAuditedPlugin(pluginInfo,pluginModule.PLUGIN_KINDS.DEPLOY_PLUGIN);
    }

    return plugin;
}

module.exports = {
    PluginAuditor,

    lookupBuildPlugin,
    lookupDeployPlugin
}

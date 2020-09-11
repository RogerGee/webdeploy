/**
 * audit.js
 *
 * @module audit
 */

const fs = require("fs");
const pathModule = require("path");
const { format, promisify } = require("util");

const sysconfig = require("./sysconfig");
const { pluginDirectories: PLUGIN_DIRS } = sysconfig;
const { makeFullPluginId,
        PLUGIN_KINDS,
        loadPluginByKind,
        parseFullPluginId,
        isDefaultPlugin,
        lookupDefaultBuildPlugin,
        lookupDefaultDeployPlugin } = require("./plugin");
const { installPluginDirect } = require("./plugin/cache");
const { WebdeployError } = require("./error");
const { mkdirParents } = require("./utils");

// Cache plugins that have been audited here. Plugins are keyed such that
// AUDITED_PLUGINS[KIND][ID] gets the plugin. The KIND is one of 'build' or
// 'deploy' and the ID is the fully-qualified plugin ID.
const AUDITED_PLUGINS = {
    build: {},
    deploy: {}
}

/**
 * Provides useful functionality for a plugin to use during its audit phase.
 */
class AuditContext {
    constructor(plugin,tree,logger,auditor) {
        this.tree = tree;
        this.logger = logger;
        this.auditor = auditor;
        this.basePath = sysconfig.makePath("cache",plugin.pluginId);
        this.package = require("./package");
        this.plugins = { build:{}, deploy:{} };
    }

    /**
     * Requires a build plugin that will be audited in turn.
     *
     * @param {object} item
     *  A plugin 'requires' value.
     * @param {object} [settings]
     */
    requireBuild(item,settings) {
        var order = parseRequires(item);
        order.plugin.pluginKind = PLUGIN_KINDS.BUILD_PLUGIN;
        if (settings) {
            order.settings = [settings];
        }
        else if (!Array.isArray(order.settings)) {
            order.settings = [order.settings];
        }
        addPluginToCollection(order,this.plugins);
    }

    /**
     * Requires a deploy plugin that will be audited in turn.
     *
     * @param {object} item
     *  A plugin 'requires' value.
     * @param {object} [settings]
     */
    requireDeploy(item,settings) {
        var order = parseRequires(item);
        order.plugin.pluginKind = PLUGIN_KINDS.DEPLOY_PLUGIN;
        if (settings) {
            order.settings = settings;
        }
        addPluginToCollection(order,this.plugins);
    }

    /**
     * Creates a cache path for use by the plugin.
     *
     * @return {Promise<string>}
     */
    async makeCachePath(path) {
        var cachePath = pathModule.join(this.basePath,path);
        await mkdirParents(cachePath,sysconfig.makePath());

        return cachePath;
    }

    /**
     * Creates a list of plugin audit orders from the context's internal list of
     * requires.
     *
     * @return {module:audit~auditOrder[]}
     */
    createOrders() {
        return Object.values(this.plugins.build)
            .concat(Object.values(this.plugins.deploy));
    }

    /**
     * Tests a path relative.
     *
     * @return {Promise<boolean>}
     */
    async testPath(path) {
        if (!this.tree) {
            return false;
        }

        const fullPath = pathModule.join(this.tree.getPath(),path);

        try {
            const stats = await promisify(fs.stat)(fullPath);
            return stats.isDirectory();

        } catch (ex) {
            if (ex.code != 'ENOENT') {
                throw ex;
            }
        }

        return false;
    }

    /**
     * Loads a blob from the attached tree (if any).
     *
     * @return {Promise<stream.Readable|null>}
     *  Returns a Promise to a readable stream if the blob could be loaded,
     *  otherwise the Promise resolves to null.
     */
    async getBlob(blobPath) {
        if (this.tree) {
            return this.tree.getBlob(blobPath);
        }

        return null;
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
 * @typedef auditOrder
 * @type {object}
 * @property {module:audit~pluginDescription} plugin
 *  Description of plugin to audit
 * @property {object} settings
 *  Config settings to pass to the plugin for plugin-specific audit. For build
 *  plugins, this is a list of every handler that references the plugin. For
 *  deploy plugins, this is the chosen deployment config object (either build or
 *  deploy).
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

function parseRequires(item) {
    var pluginDesc;
    var settings = {};

    if (typeof item === 'string') {
        pluginDesc = item;
    }
    else if (Array.isArray(item)) {
        pluginDesc = item[0];
        settings = item[1];
    }
    else if (typeof item === 'object' && item.id) {
        pluginDesc = item.id;
        if (item.version) {
            pluginDesc += '@' + item.version;
        }
        settings = item;
    }
    else {
        throw new WebdeployError("Plugin requires item is invalid");
    }

    return {
        plugin: parseFullPluginId(pluginDesc),
        settings
    };
}

function addPluginToCollection(order,buckets) {
    var bucket;
    var { plugin, settings } = order;
    var pluginId = makeFullPluginId(plugin);

    if (plugin.pluginKind == PLUGIN_KINDS.BUILD_PLUGIN) {
        bucket = buckets.build;

        if (!Array.isArray(settings)) {
            throw new WebdeployError(
                "Audit order for build plugin must have array of config objects"
            );
        }

        if (pluginId in bucket) {
            bucket[pluginId].settings = bucket[pluginId].settings.concat(settings);
            return;
        }
    }
    else {
        bucket = buckets.deploy;

        // NOTE: A deploy plugin should only be audited once.
        if (pluginId in bucket) {
            return;
        }
    }

    bucket[pluginId] = { plugin, settings };
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
        this.tree = null;
        this.logger = null;
        this.orders = [];
        this.plugins = { build:{}, deploy:{} };

        // Shared variables for audit.
        this.queue = null;
        this.gotError = null;
        this.callback = null;
        this.index = 0;
    }

    /**
     * Attaches a tree instance to the auditor. The tree can be used by plugins
     * for loading files during the audit phase.
     *
     * @param {module:tree~TreeBase} tree
     *  The tree instance to attach to the auditor.
     */
    attachTree(tree) {
        this.tree = tree;
    }

    /**
     * Attaches a logger to the auditor. The auditor will write log messages to
     * this logger as it audits/installs plugins.
     *
     * @param {object} logger
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
     * @param {module:audit~auditOrder[]} orders
     *  List of plugin audit orders to process.
     * @param {module:audit~PluginAuditor~orderCallback} [callback]
     *  Optional callback that handles the resolution of the requested plugins.
     */
    addOrders(orders,callback) {
        if (typeof callback === 'function') {
            this.orders.push({
                plugins: orders.map((order) => order.plugin),
                callback
            });
        }

        for (let i = 0;i < orders.length;++i) {
            addPluginToCollection(orders[i],this.plugins);
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
        this.callback = (err) => {
            this.queue = null;
            //this.gotError = null; // Do not reset error flag!
            this.callback = null;
            this.index = null;
            callback(err);
        };

        this.queue = Object.values(this.plugins.build)
            .concat(Object.values(this.plugins.deploy));

        this.log("Auditing plugins");
        this.beginLog();
        this.gotError = false;

        this._next();
    }

    _next(queue) {
        const { plugin, settings } = this.queue.shift();
        const { pluginVersion: version } = plugin;

        // Make fully-qualified plugin ID with version. Omit version if latest;
        // this allows us to maintain latest and versioned separately.
        if (version && version != "latest") {
            plugin.fullId = makeFullPluginId(plugin);
        }
        else {
            plugin.fullId = plugin.pluginId;
        }

        // If the plugin is a built-in (i.e. default) plugin, then we can skip
        // the completion check and call the next step.
        if (isDefaultPlugin(plugin)) {
            this._finishComplete(plugin,settings);
            return;
        }

        this.index = 0;
        this._complete(plugin,settings);
    }

    _complete(plugin,settings) {
        if (this.gotError) {
            return;
        }

        if (this.index < PLUGIN_DIRS.length) {
            let next = pathModule.join(PLUGIN_DIRS[this.index++],plugin.fullId);

            fs.stat(next, (err,stats) => {
                if (!err && stats.isDirectory()) {
                    this._finishComplete(plugin,settings);
                }
                else {
                    this._complete(plugin);
                }
            });
        }
        else {
            if (!plugin.pluginVersion) {
                this._err(
                    new WebdeployError(
                        format("Plugin '%s' must have a version constraint",plugin.pluginId)
                    )
                );
            }
            else {
                installPluginDirect(
                    plugin,
                    () => this._finishComplete(plugin,settings),
                    (err) => this._err(err),
                    this.logger
                );
            }
        }
    }

    _finishComplete(plugin,settings) {
        // Load the plugin and attach to loader info.
        plugin.pluginObject = addAuditedPlugin(plugin);

        // If the plugin provides its own 'audit' procedure, invoke it.
        if (typeof plugin.pluginObject.audit === 'function' && settings) {
            var context = new AuditContext(plugin,this.tree,this.logger);
            var promise = plugin.pluginObject.audit(context,settings);

            if (!(promise instanceof Promise)) {
                throw new WebdeployError('Plugin audit function must return a promise');
            }

            promise
                .then(() => this._done(plugin,context))
                .catch((err) => this._err(err));
        }
        else {
            this._done(plugin);
        }
    }

    _done(plugin,auditContext) {
        // Enqueue any required plugins here for subsequent loading.
        if (plugin.pluginObject.requires) {
            var requires = plugin.pluginObject.requires;

            if (requires.build) {
                for (let i = 0;i < requires.build.length;++i) {
                    var { plugin: newPlugin, settings } = parseRequires(requires.build[i]);
                    newPlugin.pluginKind = PLUGIN_KINDS.BUILD_PLUGIN;

                    if (!Array.isArray(settings)) {
                        settings = [settings];
                    }

                    this.queue.push({ plugin:newPlugin, settings });
                }
            }
            if (requires.deploy) {
                for (let i = 0;i < requires.deploy.length;++i) {
                    var { plugin: newPlugin, settings } = parseRequires(requires.deploy[i]);
                    newPlugin.pluginKind = PLUGIN_KINDS.DEPLOY_PLUGIN;

                    this.queue.push({ plugin:newPlugin, settings });
                }
            }
        }

        // Enqueue any required plugins from the auditor context.
        if (auditContext) {
            auditContext.createOrders().forEach((order) => {
                this.queue.push(order);
            });
        }

        // Resolve the promise if we are done. Otherwise continue processing.
        if (this.queue.length == 0) {
            // Resolve all orders by calling the callbacks.
            this.orders.forEach((order) => {
                if (order.callback) {
                    order.callback(order.plugins);
                }
            });

            this.log("Done auditing plugins");
            this.endLog();

            this.callback();
        }
        else {
            this._next();
        }
    }

    _err(err) {
        if (!this.gotError) {
            this.gotError = true;
            this.callback(err);
        }
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

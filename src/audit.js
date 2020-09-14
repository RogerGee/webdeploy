/**
 * audit.js
 *
 * @module audit
 */

const fs = require("fs");
const pathModule = require("path");
const { promisify } = require("util");
const sysconfig = require("./sysconfig");
const { Plugin, make_default_plugin } = require("./plugin");
const { WebdeployError } = require("./error");
const { mkdirParents } = require("./utils");

const AUDITED_PLUGINS = make_plugin_buckets();

function make_plugin_buckets() {
    return {
        [Plugin.TYPES.BUILD]: {},
        [Plugin.TYPES.DEPLOY]: {}
    };
}

/**
 * @typedef pluginDesc
 * @type {object}
 * @property {string} id The identifier of the plugin
 * @property {string} type One of Plugin.TYPES
 * @property {module:plugin~Plugin} [plugin] The loaded plugin instance. This
 * property is set when when an audit returns.
 */

/**
 * @typedef auditOrder
 * @type {object}
 * @property {module:audit~pluginDesc} desc
 *  Description of plugin to audit
 * @property {module:deployer/deploy-config~DeployConfig|module:builder/build-handler~BuildHandler[]} settings
 *  Config settings to pass to the plugin for plugin-specific audit. For build
 *  plugins, this is a list of every handler that references the plugin. For
 *  deploy plugins, this is the chosen deployment config object (either build or
 *  deploy).
 */

/**
 * Callback invoked when a load order has resolved in the auditor.
 * @callback module:audit~PluginAuditor~orderCallback
 * @param {module:audit~pluginDesc[]} plugins
 *  List of resolved plugin descriptions.
 */

/**
 * Loads a plugin. Plugins are cached globally in this module so that subsequent
 * loads for the same plugin hit the auditor cache.
 *
 * @param {module:audit~pluginDesc} desc
 *  The description of the plugin to load.
 *
 * @return {module:plugin~Plugin}
 */
function load_plugin_cache(desc) {
    const bucket = AUDITED_PLUGINS[desc.type];

    if (desc.id in bucket) {
        return bucket[desc.id];
    }

    const plugin = new Plugin(desc.id,desc.type);

    bucket[plugin.id] = plugin;

    return plugin;
}

/**
 * @return {module:audit~auditOrder}
 */
function parse_requires(parent,item,type) {
    let settings = {};
    const desc = {
        id: null,
        type
    };

    if (typeof item === 'string') {
        desc.id = item;
    }
    else if (Array.isArray(item)) {
        desc.id = item[0];
        settings = item[1];
    }
    else if (typeof item === 'object' && item.id) {
        desc.id = item.id;
        settings = item;
    }
    else {
        throw new WebdeployError("Plugin '%s' has invalid 'requires' property",parent.id);
    }

    return {
        desc,
        settings
    };
}

function push_buckets(order,buckets) {
    const { desc, settings } = order;
    const bucket = buckets[desc.type];

    if (desc.type == Plugin.TYPES.BUILD) {
        let add = settings;
        if (!Array.isArray(add)) {
            add = [settings];
        }

        // Augment settings so each instance gets audited.
        if (desc.id in bucket) {
            bucket[desc.id].settings = bucket[desc.id].settings.concat(add);
            return;
        }
    }
    else {
        // NOTE: A deploy plugin should only be audited once.
        if (desc.id in bucket) {
            return;
        }
    }

    bucket[desc.id] = { desc, settings };
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
        this.plugins = make_plugin_buckets();
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
                plugins: orders.map((order) => order.desc),
                callback
            });
        }

        for (let i = 0;i < orders.length;++i) {
            push_buckets(orders[i],this.plugins);
        }
    }

    /**
     * Ensures that the local environment can load the set of plugins previously
     * supplied.
     *
     * @return {Promise}
     */
    async audit() {
        const queue = Object.values(this.plugins.build)
              .concat(Object.values(this.plugins.deploy));

        this.log("Auditing plugins");
        this.beginLog();

        while (queue.length > 0) {
            const { desc, settings } = queue.shift();
            const plugin = load_plugin_cache(desc);

            desc.plugin = plugin;

            // Enqueue plugin requires.

            if (plugin.requires.build) {
                plugin.requires.build.forEach(
                    (req) => queue.push(parse_requires(plugin,req,Plugin.TYPES.BUILD))
                );
            }

            if (plugin.requires.deploy) {
                plugin.requires.deploy.forEach(
                    (req) => queue.push(parse_requires(plugin,req,Plugin.TYPES.DEPLOY))
                );
            }

            // Run plugin-specific auditing. Enqueue orders created by the
            // plugin.

            if (plugin.canAudit()) {
                const context = new AuditContext(plugin,this.tree,this.logger);
                await plugin.audit(context,settings);

                context.createOrders().forEach((order) => queue.push(order));
            }
        }

        this.orders.forEach((order) => {
            if (order.callback) {
                order.callback(order.plugins);
            }
        });
    }
}

/**
 * Provides useful functionality for a plugin to use during its audit phase.
 */
class AuditContext {
    /**
     * @param {module:plugin~Plugin} plugin
     * @param {module:tree~TreeBase} tree
     * @param {module:logger} logger
     * @param {module:audit~PluginAuditor} auditor
     */
    constructor(plugin,tree,logger,auditor) {
        this.parent = plugin;
        this.tree = tree;
        this.logger = logger;
        this.auditor = auditor;
        this.basePath = sysconfig.makePath("cache",plugin.id);
        this.package = require("./package");
        this.plugins = make_plugin_buckets();
    }

    /**
     * Requires a build plugin that will be audited in turn.
     *
     * @param {object} item
     *  A plugin 'requires' value.
     * @param {object} [settings]
     *  Overrides settings found via 'item'.
     */
    requireBuild(item,settings) {
        const order = parse_requires(this.parent,item,Plugin.TYPES.BUILD);
        if (settings) {
            order.settings = [settings];
        }

        push_buckets(order,this.plugins);
    }

    /**
     * Requires a deploy plugin that will be audited in turn.
     *
     * @param {object} item
     *  A plugin 'requires' value.
     * @param {object} [settings]
     *  Overrides settings found via 'item'.
     */
    requireDeploy(item,settings) {
        const order = parse_requires(this.parent,item,Plugin.TYPES.DEPLOY);
        if (settings) {
            order.settings = settings;
        }

        push_buckets(order,this.plugins);
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

function lookupBuildPlugin(id) {
    const bucket = AUDITED_PLUGINS[Plugin.TYPES.BUILD];
    if (id in bucket) {
        return bucket[id];
    }

    const plugin = make_default_plugin(id,Plugin.TYPES.BUILD);
    if (plugin) {
        bucket[id] = plugin;
        return plugin;
    }

    throw new WebdeployError("Plugin '%s' was not audited",id);
}

function lookupDeployPlugin(id) {
    const bucket = AUDITED_PLUGINS[Plugin.TYPES.DEPLOY];
    if (id in bucket) {
        return bucket[id];
    }

    const plugin = make_default_plugin(id,Plugin.TYPES.DEPLOY);
    if (plugin) {
        bucket[id] = plugin;
        return plugin;
    }

    throw new WebdeployError("Plugin '%s' was not audited",id);
}

module.exports = {
    PluginAuditor,

    lookupBuildPlugin,
    lookupDeployPlugin
};

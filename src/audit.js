// audit.js

const plugins = require("./plugins");

// Cache plugins that have been audited here. Plugins are keyed by their
// fully-qualified names.

const auditedPlugins = {}

function addAuditedPlugin(pluginInfo) {
    var pluginId = plugins.makeFullPluginId(pluginInfo,pluginInfo.pluginKind);

    if (pluginId in auditedPlugins) {
        return auditedPlugins[pluginId];
    }

    var pluginObject = plugins.loadPluginByKind(pluginInfo,pluginInfo.pluginKind);

    auditedPlugins[pluginId] = pluginObject;

    return pluginObject;
}

function addRequiresPlugins(requires,kind) {
    let keys = Object.keys(requires);

    for (let i = 0;i < keys.length;++i) {
        let k = keys[i];

        let pluginInfo = {
            pluginId: k,
            pluginVersion: requires[k],
            pluginKind: kind
        }

        addAuditedPlugin(pluginInfo);
    }
}

class PluginAuditor {
    constructor() {
        this.orders = [];
    }

    /**
     * Adds an auditing order to the auditor.
     *
     * @param Array plugins
     *   List of plugin loader objects denoting the plugins to load. Each object
     *   should be augmented with the plugin kind as well (enumerated in
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
    }

    forEach(callback) {
        return this.pluginList.forEach(callback);
    }

    /**
     * Ensures that the local environment can load the set of plugins previously
     * supplied.
     *
     * @return Promise A Promise that resolves when all plugins have been audited.
     */
    audit() {
        // TODO

        // For now, we just assume all plugins are audited.

        for (let i = 0;i < this.orders.length;++i) {
            let order = this.orders[i];

            for (let j = 0;j < order.plugins.length;++j) {
                let plugin = order.plugins[j];

                plugin.pluginObject = addAuditedPlugin(plugin);

                // Add any required plugins as well.
                if (plugin.pluginObject.requires) {
                    let requires = plugin.pluginObject.requires;

                    if (requires.build) {
                        addRequiresPlugins(requires.build,plugins.PLUGIN_KINDS.BUILD_PLUGIN);
                    }
                    if (requires.deploy) {
                        addRequiresPlugins(requires.deploy,plugins.PLUGIN_KINDS.DEPLOY_PLUGIN);
                    }
                }
            }

            order.callback(order.plugins);
        }

        return Promise.resolve();
    }
}

function lookupAuditedPlugin(pluginInfo,kind) {
    var pluginId = plugins.makeFullPluginId(pluginInfo,kind);
    if (!(pluginId in auditedPlugins)) {
        throw new Error("Plugin '" + pluginId + "' was not in the set of audited plugins");
    }

    return auditedPlugins[pluginId];
}

function lookupBuildPlugin(pluginInfo) {
    var plugin = plugins.lookupDefaultBuildPlugin(pluginInfo);
    if (!plugin) {
        plugin = lookupAuditedPlugin(pluginInfo,plugins.PLUGIN_KINDS.BUILD_PLUGIN);
    }

    return plugin;
}

function lookupDeployPlugin(pluginInfo) {
    var plugin = plugins.lookupDefaultDeployPlugin(pluginInfo);
    if (!plugin) {
        plugin = lookupAuditedPlugin(pluginInfo,plugins.PLUGIN_KINDS.DEPLOY_PLUGIN);
    }

    return plugin;
}

module.exports = {
    PluginAuditor,

    lookupBuildPlugin,
    lookupDeployPlugin
}

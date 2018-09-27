// plugins.js

const fs = require("fs");
const pathModule = require("path");

const PLUGIN_KINDS = {
    BUILD_PLUGIN: 0,
    DEPLOY_PLUGIN: 1
}

function mkdirParents(path,base) {
    var parsed = pathModule.parse(path);
    var parts = pathModule.join(parsed.dir,parsed.base).split(pathModule.sep)
        .filter((x) => {
            return Boolean(x);
        })

    if (!base) {
        path = parsed.root;
    }
    else {
        // Assume base exists.
        path = base;
    }

    for (var i = 0;i < parts.length;++i) {
        path = pathModule.join(path,parts[i]);

        try {
            fs.mkdirSync(path);
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    }
}

function makeFullPluginId(pluginInfo,kind) {
    var { pluginId, pluginVersion } = pluginInfo;

    if (pluginVersion && pluginVersion != "latest") {
        pluginId += "@" + pluginVersion;
    }

    if (typeof kind !== 'undefined') {
        pluginId += "--" + (kind == PLUGIN_KINDS.BUILD_PLUGIN ? 'build' : 'deploy');
    }

    return pluginId;
}

function requirePlugin(pluginInfo,kind) {
    // There is nothing special about a plugin - it's just a NodeJS module that
    // we "require" like any other. There are two possible ways we require a
    // plugin: 1) from this repository's "plugins" subdirectory or 2) globally
    // from modules made available to NodeJS.

    const pluginId = makeFullPluginId(pluginInfo);

    try {
        var plugin = require(pathModule.join("../plugins",pluginId));
    } catch (err1) {
        try {
            plugin = require(pluginId);
        } catch (err2) {
            throw err1;
        }
    }

    // Make sure the plugin module exports the correct interface (i.e. it has an
    // exec() function or employs the dual-plugin interface).
    if (typeof plugin.exec != "function") {
        if (!plugin.build && kind == PLUGIN_KINDS.BUILD_PLUGIN
            || !plugin.deploy && kind == PLUGIN_KINDS.DEPLOY_PLUGIN)
        {
            throw Error("Plugin '" + pluginId + "' does not provide required interface.");
        }

        if (kind == PLUGIN_KINDS.BUILD_PLUGIN) {
            plugin = plugin.build;
        }
        else if (kind == PLUGIN_KINDS.DEPLOY_PLUGIN) {
            plugin = plugin.deploy;
        }
        else {
            throw new Error("Plugin kind in not specified or incorrect");
        }
    }

    // Augment/overwrite the plugin object with its fully-qualified ID.
    plugin.id = pluginId;

    return plugin;
}

const DEFAULT_BUILD_PLUGINS = {
    pass: {
        exec: (target) => {
            return new Promise((resolve,reject) => {
                resolve(target.pass());
            })
        }
    }
}

const DEFAULT_DEPLOY_PLUGINS = {
    exclude: {
        id: "exclude",
        exec: (context,settings) => {
            return new Promise((resolve,reject) => {
                resolve();
            })
        }
    },

    write: {
        id: "write",
        exec: (context,settings) => {
            if (typeof settings.mode == "undefined") {
                settings.mode = 0o666;
            }
            else {
                // Force Number to convert possible string values. This works
                // for octal literals encoded as strings.
                settings.mode = Number(settings.mode);
            }

            return new Promise((resolve,reject) => {
                var pathset = new Set();

                // Make sure deploy path exists.
                mkdirParents(context.deployPath);

                for (var i = 0;i < context.targets.length;++i) {
                    var target = context.targets[i];

                    // Ensure parent directory exists.
                    if (!pathset.has(target.sourcePath)) {
                        pathset.add(target.sourcePath);
                        mkdirParents(target.sourcePath,context.deployPath);
                    }

                    // Write data to file.
                    var outPath = target.getDeployTargetPath();
                    var outStream = fs.createWriteStream(outPath,{ mode: settings.mode });
                    target.stream.pipe(outStream);
                    context.logger.log("Writing _" + outPath + "_");
                }

                resolve();
            })
        }
    }
}

function lookupDefaultPlugin(pluginInfo,kind) {
    if (kind == PLUGIN_KINDS.BUILD_PLUGIN) {
        var database = DEFAULT_BUILD_PLUGINS;
    }
    else if (kind == PLUGIN_KINDS.DEPLOY_PLUGIN) {
        var database = DEFAULT_DEPLOY_PLUGINS;
    }
    else {
        return;
    }

    if (pluginInfo.pluginId in database) {
        if (pluginInfo.pluginVersion && pluginInfo.pluginVersion != "latest") {
            // TODO Warn about default plugin not having latest version.

        }

        return database[pluginInfo.pluginId];
    }
}

module.exports = {
    PLUGIN_KINDS,

    // Loads a build plugin object.
    loadBuildPlugin: function(pluginInfo) {
        var plugin = lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.BUILD_PLUGIN);
        if (!plugin) {
            plugin = requirePlugin(pluginInfo,PLUGIN_KINDS.BUILD_PLUGIN);
        }

        return plugin;
    },

    // Loads a deploy plugin object.
    loadDeployPlugin: function(pluginInfo) {
        var plugin = lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.DEPLOY_PLUGIN);
        if (!plugin) {
            plugin = requirePlugin(pluginInfo,PLUGIN_KINDS.DEPLOY_PLUGIN);
        }

        return plugin;
    },

    loadPluginByKind: function(pluginInfo,kind) {
        var plugin = lookupDefaultPlugin(pluginInfo,kind);
        if (!plugin) {
            plugin = requirePlugin(pluginInfo,kind);
        }

        return plugin;
    },

    // Looks up a default build plugin.
    lookupDefaultBuildPlugin: function(pluginInfo) {
        return lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.BUILD_PLUGIN);
    },

    // Looks up a default deploy plugin.
    lookupDefaultDeployPlugin: function(pluginInfo) {
        return lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.DEPLOY_PLUGIN);
    },

    makeFullPluginId
}

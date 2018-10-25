// plugins.js

const fs = require("fs");
const pathModule = require("path");

const sysconfig = require("./sysconfig").config;
const { mkdirParents } = require("./utils");

const PLUGIN_KINDS = {
    BUILD_PLUGIN: 0,
    DEPLOY_PLUGIN: 1
}

function requirePlugin(pluginInfo,kind) {
    // There is nothing special about a plugin - it's just a NodeJS module that
    // we "require" like any other. Plugins are loaded from plugin directories
    // configured in the system configuration.

    const PLUGIN_DIRS = sysconfig.pluginDirectories;
    const { pluginId, pluginVersion } = pluginInfo;

    if (pluginVersion && pluginVersion != "latest") {
        pluginId = pluginId + "@" + pluginVersion;
    }

    for (let i = 0;i < PLUGIN_DIRS.length;++i) {
        let next = PLUGIN_DIRS[i];

        try {
            var plugin = require(pathModule.join(next,pluginId));
            break;
        } catch (err1) {
            continue;
        }
    }

    if (!plugin) {
        throw new Error("Cannot load plugin '" + pluginId + "'");
    }

    // Make sure the plugin module exports the correct interface (i.e. it has an
    // exec() function or employs the dual-plugin interface).
    if (typeof plugin.exec != "function") {
        if (!plugin.build && kind == PLUGIN_KINDS.BUILD_PLUGIN
            || !plugin.deploy && kind == PLUGIN_KINDS.DEPLOY_PLUGIN)
        {
            throw new Error("Plugin '" + pluginId + "' does not provide required interface.");
        }

        if (kind == PLUGIN_KINDS.BUILD_PLUGIN) {
            plugin = plugin.build;
        }
        else if (kind == PLUGIN_KINDS.DEPLOY_PLUGIN) {
            plugin = plugin.deploy;
        }
    }

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

module.exports = {
    // Loads a build plugin object.
    loadBuildPlugin: (pluginInfo) => {
        if (pluginInfo.pluginId in DEFAULT_BUILD_PLUGINS) {
            if (pluginInfo.pluginVersion && pluginInfo.pluginVersion != "latest") {
                // TODO Warn about default plugin not having non-latest version.
            }
            return DEFAULT_BUILD_PLUGINS[pluginInfo.pluginId];
        }

        return requirePlugin(pluginInfo,PLUGIN_KINDS.BUILD_PLUGIN);
    },

    // Loads a deploy plugin object.
    loadDeployPlugin: (pluginInfo) => {
        if (pluginInfo.pluginId in DEFAULT_DEPLOY_PLUGINS) {
            if (pluginInfo.pluginVersion && pluginInfo.pluginVersion != "latest") {
                // TODO Warn about default plugin not having non-latest version.
            }
            return DEFAULT_DEPLOY_PLUGINS[pluginInfo.pluginId];
        }

        return requirePlugin(pluginInfo.pluginId,PLUGIN_KINDS.DEPLOY_PLUGIN);
    }
}

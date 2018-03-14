// plugins.js

const fs = require("fs");
const pathModule = require("path");

function mkdirParents(path,base) {
    var parsed = pathModule.parse(path);
    var parts = pathModule.join(parsed.dir,parsed.base).split(pathModule.sep)
        .filter((x) => { return Boolean(x); });

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

function requirePlugin(pluginId) {
    // There is nothing special about a plugin - it's just a NodeJS module that
    // we "require" like any other. There are two possible ways we require a
    // plugin: 1) from this repository's "plugins" subdirectory or 2) globally
    // from modules made available to NodeJS.

    try {
        var plugin = require(pathModule.join("../plugins",pluginId));
    } catch (err1) {
        try {
            plugin = require(pluginId);
        } catch (err2) {
            throw err1;
        }
    }

    // Make sure it has an exec() function.
    if (typeof plugin.exec != "function") {
        throw Error("Plugin '" + pluginId + "' does not provide exec() entry point.");
    }

    return plugin;
}

const DEFAULT_BUILD_PLUGINS = {
    pass: {
        exec: (target) => {
            return new Promise((resolve,reject) => {
                resolve(target.pass());
            });
        }
    }
};

const DEFAULT_DEPLOY_PLUGINS = {
    exclude: {
        exec: (context,settings) => {
            return new Promise((resolve,reject) => {
                resolve();
            });
        }
    },

    write: {
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

                resolve(context.targets);
            });
        }
    }
};

module.exports = {
    // Loads a build plugin object.
    loadBuildPlugin: (pluginId) => {
        if (pluginId in DEFAULT_BUILD_PLUGINS) {
            return DEFAULT_BUILD_PLUGINS[pluginId];
        }

        return requirePlugin(pluginId);
    },

    // Loads a deploy plugin object.
    loadDeployPlugin: (pluginId) => {
        if (pluginId in DEFAULT_DEPLOY_PLUGINS) {
            return DEFAULT_DEPLOY_PLUGINS[pluginId];
        }

        return requirePlugin(pluginId);
    }
};

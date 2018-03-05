// plugins.js

const fs = require("fs");
const pathModule = require("path");

function mkdirParents(path,base) {
    var parsed = pathModule.parse(path);
    var parts = parsed.dir.split(pathModule.sep).filter((x) => { return Boolean(x); });

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
        exec: (context) => {
            return new Promise((resolve,reject) => {
                resolve();
            });
        }
    },

    write: {
        exec: (context) => {
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
                    var outStream = fs.createWriteStream(outPath);
                    target.inputStream.pipe(outStream);
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

        // There is nothing special about a build plugin - it's just a NodeJS
        // module that we "require" like any other.

        var plugin = require(pluginId);

        // Make sure it has an exec() function.
        if (typeof plugin.exec != "function") {
            throw Error("Plugin '" + pluginId + "' does not provide exec() entry point.");
        }

        return plugin;
    },

    // Loads a deploy plugin object.
    loadDeployPlugin: (pluginId) => {
        if (pluginId in DEFAULT_DEPLOY_PLUGINS) {
            return DEFAULT_DEPLOY_PLUGINS[pluginId];
        }

        // There is nothing special about a deploy plugin - it's just a NodeJS
        // module that we "require" like any other.

        var plugin = require(pluginId);

        // Make sure it has an exec() function.
        if (typeof plugin.exec != "function") {
            throw Error("Plugin '" + pluginId + "' does not provide exec() entry point.");
        }

        return plugin;
    }
};

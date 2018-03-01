// plugins.js

const DEFAULT_BUILD_PLUGINS = {
    pass: {
        exec: (target) => {
            target.pass();
            return target.targetName;
        }
    }
};

const DEFAULT_DEPLOY_PLUGINS = {
    exclude: {
        exec: (context) => {}
    },

    write: {
        exec: (context) => {

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

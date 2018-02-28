// build-plugins.js

function execDefaultPlugin_build(target) {
    target.pass();
}

const DEFAULT_PLUGINS = {
    build: {
        exec: execDefaultPlugin_build
    }
};

module.exports = {
    // Loads a build plugin object.
    load: (pluginId) => {
        if (pluginId in DEFAULT_PLUGINS) {
            return DEFAULT_PLUGINS[pluginId];
        }

        // There is nothing special about a build plugin - it's just a NodeJS
        // module that we "require" like any other.

        var plugin = require(pluginId);

        // Make sure it has an exec() function.
        if (typeof plugin.exec != "function") {
            throw Error("Plugin '" + pluginId + "' does not provide exec() entry point.");
        }

        return plugin;
    }
};

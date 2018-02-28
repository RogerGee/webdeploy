// build-plugins.js

function execDefaultPlugin_pass(target) {
    target.pass();
    return true;
}

const DEFAULT_PLUGINS = {
    pass: {
        exec: execDefaultPlugin_pass
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

/**
 * index.js
 *
 * @module plugin
 */

const path = require("path");
const { format } = require("util");
const { build: DEFAULT_BUILD_PLUGINS,
        deploy: DEFAULT_DEPLOY_PLUGINS } = require("./default");
const { pluginDirectories: PLUGIN_DIRS } = require("../sysconfig");
const { WebdeployError } = require("../error");

const PLUGIN_PREFIX = "@webdeploy/plugin-";

function lookup_default_plugin(id,type) {
    let plugins;
    if (type == Plugin.TYPES.BUILD) {
        plugins = DEFAULT_BUILD_PLUGINS;
    }
    else if (type == Plugin.TYPES.DEPLOY) {
        plugins = DEFAULT_DEPLOY_PLUGINS;
    }
    else {
        throw new WebdeployError("Plugin type '%s' is invalid");
    }

    if (id in plugins) {
        return plugins[id];
    }

    return null;
}

function require_plugin(path) {
    try {
        return require(path);
    } catch (err) {
        if (err.code !== 'MODULE_NOT_FOUND' || !err.message.match(path)) {
            throw err;
        }
    }

    return null;
}

class Plugin {
    constructor(id,type) {
        this.id = id;
        this.type = type;

        let plugin = null;

        // Attempt to load default plugin.

        plugin = lookup_default_plugin(this.id,this.type);

        this._default = !!plugin;
        this._project = false;
        this._global = false;

        // Attempt to load plugin using node_modules.

        if (!plugin) {
            plugin = require_plugin(PLUGIN_PREFIX + id);
            this._project = !!plugin;
        }

        // Try configured plugin directories if not found. This is designed to
        // development purposes.

        if (!plugin) {
            let i = 0;
            while (i < PLUGIN_DIRS.length && !plugin) {
                plugin = require_plugin(path.join(PLUGIN_DIRS[i],this.id));
                i += 1;
            }

            this._global = !!plugin;
        }

        if (!plugin) {
            throw new WebdeployError("Plugin '%s' could not be loaded",this.id);
        }

        this._setPlugin(plugin);
    }

    getType() {
        return this.type;
    }

    /**
     * Determines if the plugin can be audited.
     *
     * @return {boolean}
     */
    canAudit() {
        return typeof this._audit !== "undefined";
    }

    /**
     * Invokes the plugin audit routine. If the plugin did not provide an audit
     * procedure, then this method does nothing.
     *
     * @param {module:audit~AuditContext} context
     * @param {module:deployer/deploy-config~DeployConfig|module:builder/build-handler~BuildHandler[]} settings
     *
     * @return {Promise}
     */
    async audit(context,settings) {
        if (typeof this._audit === "undefined") {
            return;
        }

        if (typeof this._audit !== "function") {
            throw new WebdeployError("Plugin '%s' audit property must be function");
        }

        // Settings based to build plugins for audit routine must be an array.
        if (this.type == Plugin.TYPES.BUILD && !Array.isArray(settings)) {
            settings = [settings];
        }

        return this._audit(context,settings);
    }

    _setPlugin(plugin) {
        // Set plugin properties we care about on this object. All other
        // properties are ignored.

        this.requires = plugin.requires || {};

        // Make sure the plugin module exports the correct interface (i.e. it
        // has an exec() function or employs the dual-plugin interface).
        if (typeof plugin.exec !== "function") {
            if ((typeof plugin.build !== "function"
                 && this.type == Plugin.TYPES.BUILD)
                || (typeof plugin.deploy !== "function"
                    && this.type == Plugin.TYPES.DEPLOY))
            {
                throw new WebdeployError(
                    "Plugin '%s' does not provide required interface",
                    this.id
                );
            }

            if (this.type == Plugin.TYPES.BUILD) {
                this.exec = plugin.build;
            }
            else if (this.type == Plugin.TYPES.DEPLOY) {
                this.exec = plugin.deploy;
            }
            else {
                throw new WebdeployError("Plugin type '%s' is incorrect",this.type);
            }
        }
        else {
            this.exec = plugin.exec;
        }

        if (typeof plugin.audit !== "undefined") {
            if (typeof plugin.audit !== "function") {
                throw new WebdeployError("Plugin '%s' audit property must be function");
            }
            this._audit = plugin.audit;
        }
    }
}

Plugin.TYPES = {
    /**
     * A build plugin is used to translate a single target from one state to
     * another in a build.
     */
    BUILD: 'build',

    /**
     * A deploy plugin is used to translate one or more targets from one state
     * to another during a deploy.
     */
    DEPLOY: 'deploy'
};

module.exports = {
    Plugin,

    make_default_plugin(id,type) {
        const plugin = lookup_default_plugin(id,type);

        if (plugin) {
            return new Plugin(id,type);
        }

        return null;
    }
};

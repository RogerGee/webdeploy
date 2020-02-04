/**
 * deploy-config.js
 *
 * @module deployer/deploy-config
 */

const { PLUGIN_KINDS, parseFullPluginId } = require("../plugins");
const { WebdeployError } = require("../error");

/**
 * Represents a deploy configuration object
 */
class DeployConfig {
    /**
     * @param {object} settings
     *  Settings passed in from the deploy configuration.
     * @param {string} settings.id
     * @param {string} [settings.version="latest"]
     * @param {object[]} [settings.chain]
     * @param {object} [settings.requires]
     */
    constructor(settings) {
        if (typeof settings == "object") {
            Object.assign(this,settings);
        }
        else if (typeof settings == "string") {

        }
        else {
            throw new WebdeployError("Cannot create deploy config: invalid value");
        }

        // Apply defaults.

        if (typeof this.version == "undefined") {
            this.version = "latest";
        }

        this.plugin = null; // set later after auditing

        if (typeof this.requires == "undefined") {
            this.requires = {
                build: [],
                deploy: []
            }
        }

        if (typeof this.chain == "undefined") {
            this.chain = [];
        }

        // Normalize and validate settings.

        if (typeof this.id != "string") {
            throw new WebdeployError("Cannot create deploy config: invalid or missing 'id' property");
        }

        if (typeof this.version != "string") {
            throw new WebdeployError("Cannot create deploy config: invalid 'version' property");
        }

        if (!Array.isArray(this.chain)) {
            this.chain = [this.chain];
        }
        for (let i = 0;i < this.chain.length;++i) {
            this.chain[i] = new DeployConfig(this.chain[i]);
        }

        if (typeof this.requires != "object") {
            throw new WebdeployError("Cannot create deploy config: invalid 'requires' property");
        }

        for (var key of ['build','deploy']) {
            if (!Array.isArray(this.requires[key])) {
                this.requires[key] = [this.requires[key]];
            }
            for (let i = 0;i < this.requires[key].length;++i) {
                let value = this.requires[key][i];
                if (typeof value == "string") {
                    this.requires[key][i] = parseFullPluginId(value);
                }
                else if (typeof value != "object" || typeof value.id != "string") {
                    throw new WebdeployError("Cannot create deploy config: invalid plugin in 'requires'");
                }
            }
        }
    }

    /**
     * Gets a list of plugin descriptions suitable for auditing. This obtains
     * all chained plugins recursively.
     *
     * @return {module:audit~pluginDescription[]}
     *  Note the descriptions are augmented with a resolve() function for
     *  auditing resolution.
     */
    getPluginDescriptions() {
        var plugins = [];

        // Add configured deploy plugin first.
        plugins.push({
            pluginId: this.id,
            pluginVersion: this.version,
            pluginKind: PLUGIN_KINDS.DEPLOY_PLUGIN,

            resolve: (pluginObject) => {
                this.plugin = pluginObject;
            }
        })

        // Add configured plugin requires.
        for (let key of ['build','deploy']) {
            for (let i = 0;i < this.requires[key].length;++i) {
                plugins.push(Object.assign({
                    pluginKind: (key == 'build')
                        ? PLUGIN_KINDS.BUILD_PLUGIN : PLUGIN_KINDS.DEPLOY_PLUGIN
                }, this.requires[key][i]));
            }
        }

        // Recursively add all chained plugins.
        for (var i = 0;i < this.chain.length;++i) {
            plugins = plugins.concat(this.chain[i].getPluginDescriptions());
        }

        return plugins;
    }

    /**
     * Calls the assigned deploy plugin's underlying exec() method and
     * recursively executes any chained deploy plugins in the same manner.
     *
     * @return {Promise}
     *  Promise resolves when the execution has finished.
     */
    execute(context) {
        var chain;
        var chainIndex = 0;
        chain = (done) => {
            if (chainIndex >= this.chain.length) {
                return true;
            }

            return this.chain[chainIndex++].execute(context).then(chain);
        }

        return context.execute(this.plugin,this).then(chain);
    }
}

module.exports = {
    DeployConfig
}

/**
 * deploy-config.js
 *
 * @module deployer/deploy-config
 */

const { PLUGIN_KINDS, parseFullPluginId } = require("../plugin");
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
     * @param {object} [settings.chain]
     * @param {object[]} [settings.chain.predeploy]
     * @param {object[]} [settings.chain.postdeploy]
     * @param {object} [settings.requires]
     */
    constructor(settings) {
        if (typeof settings === "object") {
            Object.assign(this,settings);
        }
        else if (typeof settings === "string") {
            this.id = settings;
        }
        else {
            throw new WebdeployError("Cannot create deploy config: invalid value");
        }

        // Apply defaults.

        if (typeof this.version === "undefined") {
            var full = parseFullPluginId(this.id);
            this.id = full.pluginId,
            this.version = full.pluginVersion;
        }

        this.plugin = null; // set later after auditing

        if (typeof this.requires === "undefined") {
            this.requires = {
                build: [],
                deploy: []
            }
        }

        if (typeof this.chain === "undefined") {
            this.chain = [];
        }

        // Normalize and validate settings.

        if (typeof this.id !== "string") {
            throw new WebdeployError("Cannot create deploy config: invalid or missing 'id' property");
        }

        if (typeof this.version !== "string") {
            throw new WebdeployError("Cannot create deploy config: invalid 'version' property");
        }

        if (this.chain) {
            if (typeof this.chain !== 'object') {
                throw new WebdeployError("Cannot create deploy config: invalid 'chain' property");
            }

            var chainInfo = this.chain;
            this.chain = {
                predeploy: [],
                postdeploy: []
            };
            for (let key in this.chain) {
                if (chainInfo[key]) {
                    if (!Array.isArray(chainInfo[key])) {
                        throw new WebdeployError("Cannot create deploy config: invalid 'chain' property");
                    }

                    for (let i = 0;i < chainInfo[key].length;++i) {
                        this.chain[key].push(new DeployConfig(chainInfo[key][i]));
                    }
                }
            }
        }

        if (typeof this.requires !== "object") {
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
                else if (typeof value !== "object" || typeof value.id !== "string") {
                    throw new WebdeployError("Cannot create deploy config: invalid plugin in 'requires'");
                }
            }
        }
    }

    /**
     * Gets a list of plugin descriptions suitable for auditing. This obtains
     * all chained plugins recursively.
     *
     * @return {module:audit~auditOrder[]}
     */
    getAuditOrders() {
        var orders = [];

        // Add configured deploy plugin first.
        orders.push({
            plugin: {
                pluginId: this.id,
                pluginVersion: this.version,
                pluginKind: PLUGIN_KINDS.DEPLOY_PLUGIN,

                // NOTE: This function is used by the Deployer class to set the
                // plugin on this DeployConfig instance.
                resolve: (pluginObject) => {
                    this.plugin = pluginObject;
                }
            },

            settings: this
        });

        // Add requires configured in deploy plugin. Note that these requires do
        // not allow a config so we pass an empty object.
        for (let key of ['build','deploy']) {
            let pluginKind =
                (key == 'build')
                ? PLUGIN_KINDS.BUILD_PLUGIN
                : PLUGIN_KINDS.DEPLOY_PLUGIN;

            for (let i = 0;i < this.requires[key].length;++i) {
                orders.push({
                    plugin: Object.assign(
                        {
                            pluginKind
                        },
                        this.requires[key][i]
                    ),

                    settings: (key == 'build' ? [{}] : {})
                });
            }
        }

        // Recursively add all chained plugins.
        for (var key in this.chain) {
            for (var i = 0;i < this.chain[key].length;++i) {
                let chain = this.chain[key][i];
                orders = orders.concat(chain.getAuditOrders());
            }
        }

        return orders;
    }

    /**
     * Calls the assigned deploy plugin's underlying exec() method and
     * recursively executes any chained deploy plugins in the same manner.
     *
     * @param {module:context~DeployContext} context
     *  The deploy context to pass to use to execute the plugin.
     * @param {boolean} [asChain]
     *  If true, then the plugin is executed as a chained plugin via
     *  DeployContext.chain().
     *
     * @return {Promise}
     *  Promise resolves when the execution has finished.
     */
    execute(context,asChain) {
        var predeploy = this.makeChainCallback(context,'predeploy');
        var exec = () => {
            if (asChain) {
                return context.chain(this.plugin,this);
            }

            return context.execute(this.plugin,this);
        };
        var postdeploy = this.makeChainCallback(context,'postdeploy');

        return predeploy(false).then(exec).then(postdeploy);
    }

    /**
     * Creates a callback for invoking deploy chains.
     *
     * @param {string} type
     *  Either 'predeploy' or 'postdeploy'.
     *
     * @return {function}
     */
    makeChainCallback(context,type) {
        var index = 0;
        var callback;

        callback = (done) => {
            if (index >= this.chain[type].length) {
                return Promise.resolve(true);
            }

            return this.chain[type][index++].execute(context,true).then(callback);
        };

        return callback;
    }
}

module.exports = {
    DeployConfig
}

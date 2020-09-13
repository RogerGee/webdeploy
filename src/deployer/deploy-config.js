/**
 * deploy-config.js
 *
 * @module deployer/deploy-config
 */

const { format } = require("util");
const { Plugin } = require("../plugin");
const { BuildHandler } = require("../builder/build-handler");
const { WebdeployError } = require("../error");

/**
 * Represents a deploy configuration object
 */
class DeployConfig {
    /**
     * @param {object} settings
     *  Settings passed in from the deploy configuration.
     * @param {string} settings.id
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
            if (typeof this.requires[key] === "undefined") {
                this.requires[key] = [];
            }
            else if (!Array.isArray(this.requires[key])) {
                this.requires[key] = [this.requires[key]];
            }
        }

        const buildKey = format("%s.requires.build",this.id);
        this.requires.build = this.requires.build.map((req) => new BuildHandler(buildKey,req));
        this.requires.deploy = this.requires.deploy.map((req) => new DeployConfig(req));
    }

    /**
     * Gets a list of plugin descriptions suitable for auditing. This obtains
     * all chained plugins recursively.
     *
     * @return {module:audit~auditOrder[]}
     */
    getAuditOrders() {
        let orders = [];

        // Add configured deploy plugin first.
        orders.push({
            desc: {
                id: this.id,
                type: Plugin.TYPES.DEPLOY,

                // NOTE: This function is used by the Deployer class to set the
                // plugin on this DeployConfig instance.
                resolve: (plugin) => {
                    this.plugin = plugin;
                }
            },

            settings: this
        });

        // Add plugin requires: build and deploy.

        this.requires.build.forEach((handler) => orders.push(handler.makeAuditOrder()));
        this.requires.deploy.forEach((config) => {
            orders = orders.concat(config.getAuditOrders());
        });

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
    async execute(context,asChain) {
        await this.executeChain(context,"predeploy");
        if (asChain) {
            await context.chain(this.plugin,this);
        }
        else {
            await context.execute(this.plugin,this);
        }
        await this.executeChain(context,"postdeploy");
    }

    /**
     * Executes a deploy chain.
     *
     * @param {string} type
     *  Either 'predeploy' or 'postdeploy'.
     *
     * @return {Promise}
     */
    async executeChain(context,type) {
        const chain = this.chain[type];

        for (let i = 0;i < chain.length;++i) {
            await chain[i].execute(context,true);
        }
    }
}

module.exports = {
    DeployConfig
};

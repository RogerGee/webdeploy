/**
 * deployer.js
 *
 * @module deployer
 */

const { DeployConfig } = require("./deploy-config");
const { parseFullPluginId } = require("../plugin");
const audit = require("../audit");
const DeployContext = require("../context");
const { WebdeployError } = require("../error");

const DEPLOYER_STATE_INITIAL = 0;
const DEPLOYER_STATE_FINALIZED = 1;

/**
 * Encapsulates core deploy operations.
 */
class Deployer {
    /**
     * Creates a new Deployer instance.
     *
     * @param {object} options
     *  Options used to configure the deployer
     * @param {string} options.deployPath
     *  The deploy path to configure for the deployment.
     * @param {object} options.deployConfig
     *  The deploy plugin to utilize for the deployment.
     * @param {nodegit.Tree} options.tree
     *  The git tree instance associated with the deployment.
     */
    constructor(options) {
        if (!options.deployPath) {
            throw new WebdeployError("No deploy path is provided in deployment options");
        }
        if (!options.deployConfig) {
            throw new WebdeployError("No deploy plugin is provided in deployment options");
        }
        if (!options.tree) {
            throw new WebdeployError("No tree specified in deployment options");
        }

        this.context = null; // NOTE: DeployContext is created during execute() step.
        this.deployConfig = new DeployConfig(options.deployConfig);
        this.deployPath = options.deployPath;
        this.callbacks = options.callbacks || {};
        this.state = DEPLOYER_STATE_INITIAL;
        this.tree = options.tree;
    }

    /**
     * Prepares the deployer for execution. The object is not actually finalized
     * until the plugins have been audited and the auditor invokes the
     * finalization callback.
     *
     * @param {module:audit~PluginAuditor} auditor
     *  The plugin auditor globally auditing all plugins.
     */
    finalize(auditor) {
        if (this.state != DEPLOYER_STATE_INITIAL) {
            throw new WebdeployError("Deployer has invalid state: not initial");
        }

        // Audit all plugins required for the deploy-phase operation.

        auditor.addOrders(this.deployConfig.getAuditOrders(), (results) => {
            // NOTE: the order that we store plugins in this.plugins IS
            // important and is guarenteed to be preserved by the auditor.

            // Resolve plugins. (This assigns plugin objects to DeployConfig
            // instances.)
            for (let i = 0;i < results.length;++i) {
                if (typeof results[i].resolve == "function") {
                    results[i].resolve(results[i].pluginObject);
                }
            }

            this.state = DEPLOYER_STATE_FINALIZED;
        })
    }

    /**
     * Executes the deployment.
     *
     * @param {module:builder~Builder} builder
     *  The builder used to build the deployment.
     *
     * @return {boolean|Promise}
     *  Returns a Promise which resolves when the execution is finished.
     */
    execute(builder) {
        if (this.state != DEPLOYER_STATE_FINALIZED) {
            throw new WebdeployError("Deployer has invalid state: not finalized");
        }

        this.context = new DeployContext(this.deployPath,builder,this.tree);

        // Hijack the chain() method so we can allow string plugin IDs that map
        // to the current deploy plugin's requires and issue the chain
        // callbacks.

        this.context.chain = (nextPlugin,settings) => {
            var plugin;

            if (typeof nextPlugin === "object") {
                plugin = nextPlugin;
            }
            else {
                var desc = parseFullPluginId(nextPlugin);
                plugin = {
                    id: desc.pluginId,
                    version: desc.pluginVersion
                }
            }

            if (this.callbacks.beforeChain) {
                this.callbacks.beforeChain(this.context.currentPlugin,plugin);
            }

            return DeployContext.prototype.chain.call(this.context,plugin,settings).then((retval) => {
                if (this.callbacks.afterChain) {
                    this.callbacks.afterChain(plugin);
                }

                return retval;
            })
        }

        // Execute deploy plugin(s).

        return this.deployConfig.execute(this.context);
    }
}

module.exports = {
    Deployer
}

/**
 * deployer.js
 *
 * @module deployer
 */

const { DeployConfig } = require("./deploy-config");
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
     * @param {module:depends~ConstDependencyGraph} options.prevGraph
     *  The dependency graph for the previous deployment.
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

        this.deployConfig = new DeployConfig(options.deployConfig);
        this.deployPath = options.deployPath;
        this.callbacks = options.callbacks || {};
        this.state = DEPLOYER_STATE_INITIAL;
        this.tree = options.tree;
        this.prevGraph = options.prevGraph
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
                    results[i].resolve(results[i].plugin);
                }
            }

            this.state = DEPLOYER_STATE_FINALIZED;
        });
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

        const context = new DeployContext(
            this.deployPath,
            builder,
            this.tree,
            this.prevGraph,
            this.callbacks
        );

        // Execute deploy plugin(s).

        return this.deployConfig.execute(context);
    }
}

module.exports = {
    Deployer
};

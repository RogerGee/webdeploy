/**
 * deployer.js
 *
 * @module deployer
 */

const pluginLoader = require("./plugins");
const audit = require("./audit");
const DeployContext = require("./context");
const { WebdeployError } = require("./error");

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
     * @param {object} options.deployPlugin
     *  The deploy plugin to utilize for the deployment.
     * @param {nodegit.Tree} options.tree
     *  The git tree instance associated with the deployment.
     */
    constructor(options) {
        if (!options.deployPath) {
            throw new WebdeployError("No deploy path is provided in deployment options");
        }
        if (!options.deployPlugin) {
            throw new WebdeployError("No deploy plugin is provided in deployment options");
        }
        if (!options.tree) {
            throw new WebdeployError("No tree specified in deployment options");
        }

        this.context = null; // NOTE: DeployContext is created during execute() step.
        this.deployPlugin = options.deployPlugin;
        this.deployPath = options.deployPath;
        this.callbacks = options.callbacks || {};
        this.plugins = [];
        this.currentPlugin = null;
        this.currentIndex = 0;
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

        // Gather plugin loader objects for all plugins required for the
        // deployer.

        var plugins = [];

        // Add configured deploy plugin first.
        plugins.push({
            pluginId: this.deployPlugin.id,
            pluginVersion: this.deployPlugin.version,
            pluginKind: pluginLoader.PLUGIN_KINDS.DEPLOY_PLUGIN,

            // Remember plugin settings by attaching them here.
            pluginSettings: this.deployPlugin
        })

        if (this.deployPlugin.chain) {
            var chain = Array.isArray(this.deployPlugin.chain)
                ? this.deployPlugin.chain
                : [this.deployPlugin.chain];

            for (var i = 0;i < chain.length;++i) {
                let pluginSettings = chain[i];

                plugins.push({
                    pluginId: pluginSettings.id,
                    pluginVersion: pluginSettings.version,
                    pluginKind: pluginLoader.PLUGIN_KINDS.DEPLOY_PLUGIN,

                    // Remember plugin settings by attaching them here.
                    pluginSettings
                })
            }
        }

        // Add order to auditor.

        auditor.addOrder(plugins, (results) => {
            // NOTE: the order that we store plugins in this.plugins IS
            // important and is guarenteed to be preserved by the auditor.

            for (let i = 0;i < results.length;++i) {
                let result = results[i];

                this.plugins.push({
                    plugin: result.pluginObject,
                    settings: result.pluginSettings
                })
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
        if (this.plugins.length == 0) {
            throw new WebdeployError("Deployer has no deploy plugins");
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
                var version;
                if (this.currentPlugin.plugin.requires && nextPlugin in this.currentPlugin.plugin.requires) {
                    version = this.currentPlugin.plugin.requires[nextPlugin];
                }
                else {
                    version = 'latest';
                }

                plugin = {
                    id: nextPlugin, // included for the 'beforeChain' callback
                    pluginId: nextPlugin,
                    pluginVersion: version
                }
            }

            if (this.callbacks.beforeChain) {
                this.callbacks.beforeChain(this.currentPlugin.plugin,plugin);
            }

            return DeployContext.prototype.chain.call(this.context,plugin,settings).then((retval) => {
                if (this.callbacks.afterChain) {
                    this.callbacks.afterChain();
                }

                return retval;
            })
        }

        // Execute deploy plugins in sequence.

        return this.executeNextPlugin(true);
    }

    executeNextPlugin(retval) {
        if (this.currentIndex < this.plugins.length) {
            this.currentPlugin = this.plugins[this.currentIndex++];

            if (this.currentIndex == 1) {
                return this.currentPlugin.plugin.exec(this.context,this.currentPlugin.settings).then(() => {
                    return this.executeNextPlugin(retval);
                })
            }

            return this.context.chain(this.currentPlugin.plugin,this.currentPlugin.settings).then(() => {
                return this.executeNextPlugin(retval);
            })
        }

        return retval;
    }
}

module.exports = Deployer;

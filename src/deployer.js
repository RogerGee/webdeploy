// deployer.js

const pluginLoader = require("./plugins");
const audit = require("./audit");
const DeployContext = require("./context");
const { WebdeployError } = require("./error");

const DEPLOYER_STATE_INITIAL = 0;
const DEPLOYER_STATE_FINALIZED = 1;

class Deployer {
    constructor(options) {
        if (!options.deployPath) {
            throw new WebdeployError("No deploy path is provided in deployment options");
        }
        if (!options.deployPlugin) {
            throw new WebdeployError("No deploy plugin is provided in deployment options");
        }

        this.context = null; // NOTE: DeployContext is created during execute() step.
        this.deployPlugin = options.deployPlugin;
        this.deployPath = options.deployPath;
        this.callbacks = options.callbacks || {};
        this.plugins = [];
        this.currentPlugin = null;
        this.currentIndex = 0;
        this.state = DEPLOYER_STATE_INITIAL;
    }

    finalize() {
        if (this.state != DEPLOYER_STATE_INITIAL) {
            throw new WebdeployError("Deployer has invalid state: not initial");
        }
        this.state = DEPLOYER_STATE_FINALIZED;

        // Audit deploy plugins required for the run.

        var auditor = new audit.PluginAuditor();
        auditor.addPluginByLoaderInfo({
            pluginId: this.deployPlugin.id,
            pluginVersion: this.deployPlugin.version,
            // Remember plugin settings by attaching them here.
            pluginSettings: this.deployPlugin
        })

        if (this.deployPlugin.chain) {
            var chain = Array.isArray(this.deployPlugin.chain)
                ? this.deployPlugin.chain
                : [this.deployPlugin.chain];

            for (var i = 0;i < chain.length;++i) {
                var pluginSettings = chain[i];
                const pluginInfo = {
                    pluginId: pluginSettings.id,
                    pluginVersion: pluginSettings.version,
                    // Remember plugin settings by attaching them here.
                    pluginSettings: pluginSettings
                }

                auditor.addPluginByLoaderInfo(pluginInfo);
            }
        }

        return auditor.audit().then(() => {
            // Load deploy plugins required by the run.

            auditor.forEach((plugin) => {
                this.plugins.push({
                    plugin: pluginLoader.loadDeployPlugin(plugin),
                    settings: plugin.pluginSettings
                })
            })
        }, (err) => {
            return Promise.reject("Failed to audit deploy plugins: " + err);
        })
    }

    execute(builder) {
        if (this.state != DEPLOYER_STATE_FINALIZED) {
            throw new WebdeployError("Deployer has invalid state: not finalized");
        }

        this.context = new DeployContext(this.deployPath,builder);

        // Hijack the chain() method so we can issue the chain callbacks.

        this.context.chain = (nextPlugin,settings) => {
            var plugin;
            if (typeof nextPlugin === "object") {
                plugin = nextPlugin;
            }
            else {
                plugin = {
                    id: nextPlugin
                }
            }

            if (this.callbacks.beforeChain) {
                this.callbacks.beforeChain(this.currentPlugin.plugin,plugin);
            }

            return DeployContext.prototype.chain.call(this.context,nextPlugin,settings).then((retval) => {
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

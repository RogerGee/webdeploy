/**
 * kernel.js
 *
 * @module kernel
 */

const xpath = require("path").posix;
const assert = require("assert");
const logger = require("./logger");
const subsystem = require("./subsystem");
const { DependencyGraph, ConstDependencyGraph } = require("./depends");
const { DelayedTarget } = require("./target");
const { Builder } = require("./builder");
const { Deployer } = require("./deployer");
const { PluginAuditor } = require("./audit");
const { WebdeployError } = require("./error");

const DEPENDS_CONFIG_KEY = "cache.depends";

function printNewTargetsCallback(target,plugin,newTargets) {
    if (newTargets.length > 0) {
        var prefix = "Exec _" + target.targetName + "_"
            + " -> *" + plugin.id + "* -> ";

        newTargetNames = newTargets.map((x) => { return x.targetName });
        logger.log(prefix + "_" + newTargetNames[0] + "_");
        for (var j = 1;j < newTargetNames.length;++j) {
            logger.log(" ".repeat(prefix.length - 7) + "-> _"
                       + newTargetNames[j] + "_");
        }
    }
}

function deployBeforeChainCallback(currentPlugin,chainedPlugin) {
    if (!currentPlugin) {
        logger.log("Chain -> *" + chainedPlugin.id + "*");
    }
    else {
        logger.log("Chain *" + currentPlugin.id + "* -> *" + chainedPlugin.id + "*");
    }
    logger.pushIndent();
}

function deployAfterChainCallback() {
    logger.popIndent();
}

class Kernel {
    /**
     * @param {module:tree~TreeBase} tree
     *  The project tree to execute.
     * @param {object} options
     * @param {string} options.type
     *  The execution type. This must be one of Kernel.TYPES.
     * @param {boolean} [options.dev]
     *  Development-mode flag
     * @param {boolean} [options.force]
     *  If true, ignore the existing deployment.
     */
    constructor(tree,options) {
        this.tree = tree;
        this.options = options;

        this.deployConfig = null;
        this.graph = null;
        this.prevGraph = null;
        this.builder = null;
        this.deployer = null;
        this.ignored = false; // true if at least one target ignored

        assert(options.type == Kernel.TYPES.BUILD
               || options.type == Kernel.TYPES.DEPLOY);
    }

    async execute() {
        // Load initial config from project tree.

        this.deployConfig = await this.tree.getTargetConfig(this.options.type);
        if (!this.deployConfig) {
            throw new WebdeployError("Deploy config was not found in target tree config");
        }

        const depends = await this.tree.getStorageConfig(DEPENDS_CONFIG_KEY);
        this.graph = new DependencyGraph(depends);
        this.prevGraph = new ConstDependencyGraph(depends);

        // Reset dependency graph if set in options.

        if (this.options.force) {
            this.graph.reset();
        }

        // Load project in subsystem.

        await subsystem.loadProject(this.tree);

        // Perform audit step to ensure all plugins and configuration is good to
        // go.

        await this.auditStep();

        // Execute the build pipeline. This will chain to the deploy pipeline
        // after the build.

        await this.buildStep();

        // Save dependency graph and finalize project tree.

        this.graph.resolve();
        await this.tree.writeStorageConfig(DEPENDS_CONFIG_KEY,this.graph.getStorageRepr());
        await this.tree.finalize();
    }

    async auditStep() {
        const treeInfo = await this.tree.getTargetConfig("info");
        logger.log("Loaded target tree config from _" + treeInfo.file + "_");

        const basePath = await this.tree.getTargetConfig("basePath",true);
        this.tree.addOption("basePath",basePath);

        const includes = await this.tree.getTargetConfig("includes");
        const auditor = new PluginAuditor();
        this.builder = this.makeBuilder();
        this.builder.pushIncludes(includes,auditor);
        this.builder.finalize(auditor);

        this.deployer = this.makeDeployer();
        this.deployer.finalize(auditor);

        // Audit all plugins before any build process has been started. This
        // will ensure all plugins are loadable or that we error out if a plugin
        // is not found.

        auditor.attachTree(this.tree);
        auditor.attachLogger(logger);

        await auditor.audit();
    }

    async buildStep() {
        await this.addTargets();

        logger.log("Building targets:");
        logger.pushIndent();

        if (this.builder.targets.length == 0) {
            logger.log("*No Targets*");
        }
        else {
            await this.builder.execute();
            logger.log("*Done*");
        }

        logger.popIndent();

        await this.deployStep();
    }

    async deployStep() {
        if (this.builder.outputTargets.length == 0) {
            logger.log("Finished:");

            if (this.ignored) {
                logger.pushIndent();
                if (this.options.type == Kernel.TYPES.BUILD) {
                    logger.log("*All Targets Ignored - Build Up-to-date*");
                }
                else {
                    logger.log("*All Targets Ignored - Deployment Up-to-date*");
                }
                logger.popIndent();
            }
            else {
                logger.pushIndent();
                logger.log("No targets to deploy");
                logger.popIndent();
            }
        }
        else {
            logger.log("Deploying targets: *" + this.deployer.deployConfig.id + "*");

            // Execute the deployer.
            logger.pushIndent();
            await this.deployer.execute(this.builder);
            logger.popIndent();
        }
    }

    makeBuilder() {
        const opts = {
            type: this.options.type,
            dev: this.options.dev,
            graph: this.graph,
            callbacks: {
                newTarget: printNewTargetsCallback
            }
        };

        return new Builder(this.tree,opts);
    }

    makeDeployer() {
        const opts = {
            callbacks: {
                beforeChain: deployBeforeChainCallback,
                afterChain: deployAfterChainCallback
            },
            prevGraph: this.prevGraph
        };

        return new Deployer(this.deployConfig,this.tree,opts);
    }

    async getIgnoredTargets() {
        // Calculate the set of ignored targets using the dependency graph.

        if (this.graph.isResolved()) {
            return this.graph.getIgnoreSources(this.tree);
        }

        return new Set();
    }

    async addTargets() {
        const ignoreSet = await this.getIgnoredTargets();

        logger.log("Adding targets:");
        logger.pushIndent();

        const opts = {
            filter(targetPath) {
                // Ignore any hidden paths.
                if (targetPath[0] == ".") {
                    return false;
                }

                return true;
            }
        };

        const callback = async ({targetPath,targetName},stream) => {
            const ref = xpath.join(targetPath,targetName);

            // Ignore potential targets that were determined to not belong in
            // the build since they map to build products that are already
            // up-to-date.

            if (ignoreSet.has(ref)) {
                this.ignored = true;
                return;
            }

            // Create a delayed target object and attempt to add it to the
            // builder.
            const delayed = new DelayedTarget(
                targetPath,
                targetName,
                {
                    createStreamFn: stream
                }
            );

            // If a potential target does not have a build product (i.e. is a
            // trivial product), then check to see if it is modified and should
            // be included or not.

            let newTarget;

            if (!this.options.force
                && this.graph.isResolved()
                && !this.graph.hasProductForSource(ref))
            {
                const result = await this.tree.isBlobModified(ref);

                if (result) {
                    newTarget = this.builder.pushInitialTargetDelayed(delayed);
                }
                else {
                    this.ignored = true;
                }
            }
            else {
                newTarget = this.builder.pushInitialTargetDelayed(delayed);
            }

            if (newTarget) {
                logger.log("Add _" + ref + "_");
            }
        };

        await this.tree.walk(callback,opts);

        if (this.builder.targets.length == 0) {
            logger.log("*No Targets*");
        }
        logger.popIndent();
    }
}

Kernel.TYPES = {
    // Uses the project tree's "build" configuration.
    BUILD: 'build',

    // Uses the project tree's "deploy" configuration.
    DEPLOY: 'deploy'
};

module.exports = {
    Kernel
};

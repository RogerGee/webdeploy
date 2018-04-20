// context.js

const targetModule = require("./target");
const plugins = require("./plugins");

/**
 * DeployContext
 *
 * The context passed in to deploy plugins. It stores a list of output targets
 * for processing.
 */
class DeployContext {
    constructor(deployPath,builder) {
        this.deployPath = deployPath;
        this.builder = builder;
        this.targets = builder.outputTargets;
        this.graph = builder.options.graph; // DependencyGraph
        this.logger = require("./logger");

        this.setTargetsDeployPath();
    }

    // Sets the deployment path for each target.
    setTargetsDeployPath() {
        for (var i = 0;i < this.targets.length;++i) {
            this.targets[i].setDeployPath(this.deployPath);
        }
    }

    // Wrapper for builder.execute() that sets output targets deploy paths.
    executeBuilder() {
        return this.builder.execute().then(() => {
            this.setTargetsDeployPath();
        });
    }

    // Gets Target. Creates a new target having the given path. The final
    // parameter is an options object with the following keys:
    //   - parents: Array of Target denoting parent targets for dependency
    //     management
    //   - isOutputTarget: true if new target should be added as an output
    //     target [default=true]
    createTarget(newTargetPath,options) {
        // Normalize and unpack options.
        options = options || {};
        var { parents, isOutputTarget } = options;
        isOutputTarget = (typeof isOutputTarget === "undefined") ? true : isOutputTarget;

        // Add dependency graph information if parents specified.
        if (parents && this.graph) {
            for (var i = 0;i < parents.length;++i) {
                this.graph.addConnection(parents[i].getSourceTargetPath(),
                                         newTargetPath);
            }
        }

        var target = targetModule.makeOutputTarget(newTargetPath);
        target.setDeployPath(this.deployPath);
        if (isOutputTarget) {
            this.targets.push(target);
        }
        return target;
    }

    // Resolves the set of "removeTargets" into a new target with the given
    // path. This essentially collapses existing targets down to a single new
    // target. The "newTargetPath" must contain both the target path and
    // name. The new target is added to the context's list of targets. The final
    // parameter is an options object with the following keys:
    //   - isOutputTarget: true if new target should be added as an output
    //     target [default=true]
    resolveTargets(newTargetPath,removeTargets,options) {
        // Normalize and unpack options.
        options = options || {};
        var { isOutputTarget } = options;
        isOutputTarget = (isOutputTarget !== "undefined") ? isOutputTarget : true

        if (removeTargets) {
            // Remove targets from our internal list.
            removeTargets.forEach((elem) => {
                var index = this.targets.indexOf(elem);
                if (index >= 0) {
                    this.targets.splice(index,1);
                }
            });
        }

        // Create new target if path is specified.
        if (newTargetPath) {
            var createOpts = {
                parents: removeTargets,
                isOutputTarget: isOutputTarget
            };
            return this.createTarget(newTargetPath,createOpts);
        }
    }

    // Gets Promise. Sends control to another deploy plugin.
    chain(nextPlugin,settings) {
        if (typeof nextPlugin === "object") {
            return nextPlugin.exec(this,settings || {});
        }

        return plugins.loadDeployPlugin(nextPlugin).exec(this,settings || {});
    }
}

module.exports = {
    DeployContext: DeployContext
};

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
        this.graph = builder.graph; // DependencyGraph
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

    // Gets Target. Creates a new output target that is added to the context's
    // list of targets.
    createTarget(newTargetPath) {
        var target = targetModule.makeOutputTarget(newTargetPath);
        target.setDeployPath(this.deployPath);
        this.targets.push(target);
        return target;
    }

    // Resolves the set of "removeTargets" into the specified new target. This
    // collapses existing targets down to a single new target. The
    // "newTargetPath" must contain both the target path and name. The new
    // target is added to the context's list of targets.
    resolveTargets(newTargetPath,removeTargets) {
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
            // Add dependency graph information.
            if (removeTargets && this.graph) {
                for (var i = 0;i < removeTargets.length;++i) {
                    this.graph.addConnection(removeTargets[i].getSourceTargetPath(),
                                             newTargetPath);
                }
            }
            return this.createTarget(newTargetPath);
        }
    }

    // Gets Promise. Sends control to another deploy plugin.
    chain(nextPlugin,settings) {
        return plugins.loadDeployPlugin(nextPlugin).exec(this,settings || {});
    }
}

module.exports = {
    DeployContext: DeployContext
};

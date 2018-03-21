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
    constructor(deployPath,targets,graph) {
        this.deployPath = deployPath;
        this.targets = targets;
        this.logger = require("./logger");
        this.graph = graph; // DependencyGraph

        // Set deployment paths for each target.
        for (var i = 0;i < this.targets.length;++i) {
            this.targets[i].setDeployPath(this.deployPath);
        }
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
        if (removeTargets && removeTargets.length > 0) {
            // Remove targets from our internal list.
            var newTargets = this.targets.filter((elem) => {
                return removeTargets.indexOf(elem) == -1;
            });
            this.targets = newTargets;
        }

        // Create new target if path is specified.
        if (newTargetPath) {
            // Add dependency graph information.
            if (removeTargets && this.graph) {
                for (var i = 0;i < removeTargets.length;++i) {
                    this.graph.addConnection(removeTargets[i].getSourceTargetPath(),newTargetPath);
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

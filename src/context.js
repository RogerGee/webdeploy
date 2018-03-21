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
    constructor(deployPath,targets) {
        this.deployPath = deployPath;
        this.targets = targets;
        this.logger = require("./logger");

        // Set deployment paths for each target.
        for (var i = 0;i < this.targets.length;++i) {
            this.targets[i].setDeployPath(this.deployPath);
        }
    }

    // Resolves the set of "removeTargets" into the specified new target. This
    // collapses existing targets down to a single new target. The
    // "newTargetPath" must contain both the target path and name.
    resolveTargets(newTargetPath,removeTargets) {
        // Remove targets from our internal list.
        var newTargets = this.targets.filter((elem) => {
            return removeTargets.indexOf(elem) == -1;
        });
        this.targets = newTargets;

        // Create new target if path is specified.
        if (newTargetPath) {
            return targetModule.makeOutputTarget(newTargetPath);
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

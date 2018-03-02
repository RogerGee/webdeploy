// context.js

const targetModule = require("./target");
const plugins = require("./plugins");

function DeployContext(deployPath,targets) {
    this.deployPath = deployPath;
    this.targets = targets;

    // Set deployment paths for each target.
    for (var i = 0;i < this.targets.length;++i) {
        this.targets[i].setDeployPath(this.deployPath);
    }
}

DeployContext.prototype.resolveTargets = function(newTargetPath,removeTargets) {
    // Remove targets from our internal list.
    var newTargets = this.targets.filter((elem) => {
        return removeTargets.indexOf(elem) == -1;
    });
    this.targets = newTargets;

    // Create new target if path is specified.
    if (newTargetPath) {
        return targetModule.makeOutputTarget(newTargetPath);
    }
};

DeployContext.prototype.chain = function(nextPlugin) {
    plugins.loadDeployPlugin(nextPlugin).exec(this);
};

module.exports = {
    DeployContext: DeployContext
};

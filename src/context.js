// context.js

const pathModule = require("path");

const targetModule = require("./target");
const { lookupDeployPlugin } = require("./audit");

/**
 * DeployContext
 *
 * The context passed in to deploy plugins. It stores a list of output targets
 * for processing.
 */
class DeployContext {
    constructor(deployPath,builder,tree) {
        this.deployPath = deployPath;
        this.builder = builder;
        this.targets = builder.outputTargets;
        this.map = {};
        this.graph = builder.options.graph; // DependencyGraph
        this.tree = tree; // git.Tree
        this.logger = require("./logger");

        // Create map for faster target lookup.
        this.targets.forEach((target) => {
            this.map[target.getSourceTargetPath()] = target;
        })

        this.setTargetsDeployPath();
    }

    // Creates an absolute path with a relative path within the deploy path.
    makeDeployPath(path) {
        return pathModule.join(this.deployPath,path);
    }

    // Sets the deployment path for each target.
    setTargetsDeployPath(force) {
        for (var i = 0;i < this.targets.length;++i) {
            if (!this.targets[i].deployPath || force) {
                this.targets[i].setDeployPath(this.deployPath);
            }
        }
    }

    // Wrapper for builder.execute() that sets output targets deploy paths.
    executeBuilder() {
        return this.builder.execute().then(() => {
            this.setTargetsDeployPath();
        })
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
            this.map[newTargetPath] = target;
        }
        return target;
    }

    // Looks up a target by its source path. Returns false if no such target was
    // found.
    lookupTarget(targetPath) {
        if (targetPath in this.map) {
            return this.map[targetPath];
        }

        return false;
    }

    // Removes targets from the context. This is the preferred way of removing
    // targets.
    removeTargets(removeTargets) {
        if (!Array.isArray(removeTargets)) {
            removeTargets = [removeTargets];
        }

        // Remove targets from our internal list and the map.
        removeTargets.forEach((elem) => {
            var index = this.targets.indexOf(elem);
            if (index >= 0) {
                this.targets.splice(index,1);
                delete this.map[elem.getSourceTargetPath()];
            }
        })
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
            this.removeTargets(removeTargets);
        }

        // Create new target if path is specified.
        if (newTargetPath) {
            var createOpts = {
                parents: removeTargets,
                isOutputTarget: isOutputTarget
            }

            return this.createTarget(newTargetPath,createOpts);
        }
    }

    // Gets Promise. Sends control to another deploy plugin. The 'nextPlugin'
    // must be an object, either an already loaded plugin or a plugin loader
    // object.
    chain(nextPlugin,settings) {
        // Execute plugin directly if it is an already-loaded plugin
        // object. This is just anything that has an exec property.

        if (nextPlugin.exec) {
            return nextPlugin.exec(this,settings || {});
        }

        return lookupDeployPlugin(nextPlugin).exec(this,settings || {});
    }
}

module.exports = DeployContext;

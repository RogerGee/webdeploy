/**
 * context.js
 *
 * @module context
 */

const pathModule = require("path");

const { makeOutputTarget } = require("./target");
const { lookupDeployPlugin } = require("./audit");

function resolveDeployPlugin(plugin) {
    // If the object does not have the correct interface, then assume it is a
    // description and look up the required plugin.
    if (!plugin.exec) {
        return lookupDeployPlugin({
            pluginId: plugin.id,
            pluginVersion: plugin.version
        });
    }

    return plugin;
}

/**
 * @callback module:context~DeployContext~TargetCallback
 * @param {module:target~Target} target
 *  The current target being selected for this iteration.
 */

/**
 * DeployContext
 *
 * The context passed in to deploy plugins. It stores a list of output targets
 * for processing.
 */
class DeployContext {
    /**
     * Creates a new DeployContext instance.
     *
     * @param {string} deployPath
     *  The base path to which targets are written.
     * @param {module:builder~Builder} builder
     *  The builder associated with the deployment.
     * @param {nodegit.Tree} tree
     *  The git tree instance associated with the deployment.
     * @param {object} [settings]
     */
    constructor(deployPath,builder,tree,settings) {
        settings = settings || {};

        this.deployPath = deployPath;
        this.builder = builder;
        this.targets = builder.outputTargets;
        this.map = {};
        this.graph = builder.options.graph; // DependencyGraph
        this.tree = tree; // git.Tree
        this.logger = require("./logger");
        this.currentPlugin = null;

        // Create map for faster target lookup.
        this.targets.forEach((target) => {
            this.map[target.getSourceTargetPath()] = target;
        })

        this.setTargetsDeployPath();
    }

    /**
     * Creates an absolute path with a relative path within the deploy path.
     *
     * @param {string} path
     *  The relative path to create into a deploy path.
     *
     * @return {string}
     */
    makeDeployPath(path) {
        return pathModule.join(this.deployPath,path);
    }

    /**
     * Sets the deployment path for each target.
     *
     * @param {boolean} force
     *  By default, the deploy path is only set on targets that do *not* have a
     *  deploy path set. If force is set to true, this behavior is overridden to
     *  where the deploy path is unconditionally set.
     */
    setTargetsDeployPath(force) {
        for (var i = 0;i < this.targets.length;++i) {
            if (!this.targets[i].deployPath || force) {
                this.targets[i].setDeployPath(this.deployPath);
            }
        }
    }

    /**
     * Wrapper for builder.execute() that sets output targets deploy paths. This
     * is the preferred way to execute the builder.
     */
    executeBuilder() {
        return this.builder.execute().then(() => {
            this.setTargetsDeployPath();
        })
    }

    /**
     * Creates a new target having the given path.
     *
     * @param {string} newTargetPath
     *  The path for the new target (relative to the deploy path).
     * @param {object} options
     *  List of options to configure the target creation.
     * @param {module:target~Target[]} options.parents
     *  List of parent targets used to create dependencies in the internal
     *  dependency graph.
     * @param {boolean} options.isOutputTarget
     *  Determines if the target should be added to the context as an output
     *  target. The default is true.
     *
     * @return {module:target~Target}
     */
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

        var target = makeOutputTarget(newTargetPath);
        target.setDeployPath(this.deployPath);
        if (isOutputTarget) {
            this.targets.push(target);
            this.map[newTargetPath] = target;
        }
        return target;
    }

    /**
     * Gets a list of all targets in the context.
     *
     * @return {module:target~Target[]}
     */
    getTargets() {
        return this.targets.slice();
    }

    /**
     * Iterates through all targets in the context and invokes the specified
     * callback.
     *
     * @param {module:context~DeployContext~TargetCallback} callback
     *  The callback to invoke.
     */
    forEachTarget(callback) {
        for (let i = 0;i < this.targets.length;++i) {
            callback(this.targets[i]);
        }
    }

    /**
     * Looks up a target by its source path.
     *
     * @param {string} targetPath
     *  A path relative to the deploy path.
     *
     * @return {module:target~Target|boolean}
     *  Returns the target if found, false otherwise.
     */
    lookupTarget(targetPath) {
        if (targetPath in this.map) {
            return this.map[targetPath];
        }

        return false;
    }

    /**
     * Removes targets from the context. This is the preferred way of removing
     * targets.
     *
     * @param {module:target~Target[]} removeTargets
     *  The list of targets to remove. A single Target instance may also be
     *  passed.
     * @param {boolean} [removeFromGraph]
     *  Determines if the targets should be removed from the dependency graph
     *  associated with the context. If true, then the targets are interpreted
     *  as build products, and all immediate connections to the target are
     *  removed from the graph.
     *
     * @return {object}
     */
    removeTargets(removeTargets,removeFromGraph) {
        var result = {
            targets: [],
            depends: []
        };

        if (!Array.isArray(removeTargets)) {
            removeTargets = [removeTargets];
        }

        // Remove targets from our internal list and the map.
        removeTargets.forEach((elem) => {
            var index = this.targets.indexOf(elem);
            if (index >= 0) {
                let targetPath = elem.getSourceTargetPath();

                this.targets.splice(index,1);
                result.targets.push(elem);
                delete this.map[targetPath];

                if (removeFromGraph) {
                    // Remove targets from the dependency graph.
                    let rm = this.graph.removeConnectionGivenProduct(targetPath);
                    rm.forEach(function(d){ result.depends.push(d); });
                }
            }
        });

        return result;
    }

    /**
     * Resolves two or more targets into a new target with the given path.
     *
     * @param {string} newTargetPath
     *  The target path. The final component in the path is the target
     *  name. Pass an empty value to avoid creating a new target.
     * @param {module:target~Target[]} removeTargets
     *  The set of targets
     * @param {object} options
     * @param {boolean} options.isOutputTarget
     *  True if the resulting target is added as an output target. Default is
     *  true.
     *
     * @return {module:target~Target}
     *  A Target instance is only returned if a new target path was provided.
     */
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
                isOutputTarget
            }

            return this.createTarget(newTargetPath,createOpts);
        }
    }

    /**
     * Executes the specified deploy plugin.
     *
     * @param {object} plugin
     *  A loaded deploy plugin or a plugin loader object.
     * @param {module:plugin/deploy-plugin~DeployPlugin} settings
     *  The deploy plugin configuration object to pass to the deploy plugin.
     *
     * @return {Promise}
     */
    execute(plugin,settings) {
        plugin = resolveDeployPlugin(plugin);
        this.currentPlugin = plugin;

        return plugin.exec(this,settings || {});
    }

    /**
     * Sends control to another deploy plugin.
     *
     * @param {object} nextPlugin
     *  A loaded deploy plugin or a plugin loader object.
     * @param {object} settings
     *  Settings to pass to the deploy plugin.
     *
     * @return {Promise}
     */
    chain(nextPlugin,settings) {
        var plugin = resolveDeployPlugin(nextPlugin);
        this.currentPlugin = plugin;

        return plugin.exec(this,settings || {});
    }
}

module.exports = DeployContext;

/**
 * context.js
 *
 * @module context
 */

const pathModule = require("path");
const subsystem = require("./subsystem");
const { format } = require("util");
const { Builder } = require("./builder");
const { Target } = require("./target");
const { lookupDeployPlugin } = require("./audit");
const { Plugin } = require("./plugin");
const { WebdeployError } = require("./error");

function resolve_deploy_plugin(plugin) {
    if (plugin instanceof Plugin) {
        return plugin;
    }

    if (typeof plugin !== "string") {
        throw new WebdeployError("Cannot execute deploy plugin: %s",JSON.stringify(plugin));
    }

    return lookupDeployPlugin(plugin);
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
     * @param {module:depends~ConstDependencyGraph} prevGraph
     *  The previous dependency graph state.
     * @param {object} callbacks
     */
    constructor(deployPath,builder,tree,prevGraph,callbacks) {
        this.deployPath = deployPath;
        this.builder = builder;

        // Create a link between the builder's output targets and the context's
        // internal list of targets.
        this.targets = builder.outputTargets;

        this.map = {};
        this.graph = builder.options.graph; // DependencyGraph
        this.prevGraph = prevGraph;
        this.tree = tree; // git.Tree
        this.logger = require("./logger");
        this.nodeModules = subsystem.nodeModules;
        this.callbacks = callbacks;
        this.currentPlugin = null;

        // Create map for faster target lookup.
        this.targets.forEach((target) => {
            this.map[target.getSourceTargetPath()] = target;
        })

        this.setTargetsDeployPath();
    }

    /**
     * Determines if the deployment is a development deployment.
     *
     * @return {boolean}
     */
    isDevDeployment() {
        // NOTE: A deployment is a development deployment if the build was a
        // development build.
        return this.builder.isDevBuild();
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
            if (!this.targets[i].hasDeployPath() || force) {
                this.targets[i].setDeployPath(this.deployPath);
            }
        }
    }

    /**
     * Creates an external sub-builder to use for recursive builds.
     *
     * @return {module:builder~Builder}
     */
    createBuilder() {
        return new Builder(this.builder.tree,this.builder.options);
    }

    /**
     * Wrapper for builder.execute() that sets output targets deploy paths. This
     * is the preferred way to execute the builder.
     *
     * @return {Promise}
     */
    executeBuilder() {
        return this.builder.execute().then(() => {
            this.setTargetsDeployPath();
        });
    }

    /**
     * Executes an external, sub-builder. This is the preferred way to execute a
     * sub-builder.
     *
     * @return {Promise}
     */
    executeExternalBuilder(builder) {
        return this.builder.executeAndMerge(builder).then(() => {
            this.setTargetsDeployPath();
        });
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

        var target = new Target(newTargetPath);
        target.setDeployPath(this.deployPath);
        if (isOutputTarget) {
            this.targets.push(target);
            this.map[newTargetPath] = target;
        }
        return target;
    }

    /**
     * Creates a new target from the given path in the project tree.
     *
     * @param {string} targetPath
     * @param {boolean} isOutputTarget
     *  If true, then the target is added to the list of output targets.
     *
     * @return {Promise<module:target~Target}
     */
    async createTargetFromTree(targetPath,isOutputTarget) {
        const blob = await this.tree.getBlob(targetPath);
        const target = new Target(targetPath,null,blob);

        if (isOutputTarget) {
            this.targets.push(target);
            this.map[targetPath] = target;
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
        const targets = this.targets.slice();
        for (let i = 0;i < targets.length;++i) {
            callback(targets[i]);
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
     * Determines if the specified input target is out of date with respect to
     * the indicated output target file.
     *
     * @param {string} inputTargetPath
     *  The path to the input target to check.
     * @param {string} outputTargetPath
     *  The path to the output target to use to determine if the input target is
     *  out of date.
     *
     * @return {Promise<boolean>}
     */
    async isTargetOutOfDate(inputTargetPath,outputTargetPath) {
        const mtime = await this.tree.getMTime(outputTargetPath);

        return await this.tree.isBlobModified(inputTargetPath,mtime);
    }

    /**
     * Sets up a target to be built using the builder attached to the
     * context. The target will be automatically removed from the context (if it
     * was a previous output target); its build product will be added back once
     * the builder execution is finished.
     *
     * @param {module:target~Target[]} target
     * @param {object[]} handlers
     */
    buildTarget(target,handlers) {
        this.builder.pushInitialTargetWithHandlers(target,handlers);
        this.removeTargets(target);
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
     *  as build products. The dependency graph is updated such that removed
     *  targets may be reloaded in another build given an out-of-date output
     *  target.
     */
    removeTargets(removeTargets,removeFromGraph) {
        if (!Array.isArray(removeTargets)) {
            removeTargets = [removeTargets];
        }

        // Remove targets from our internal list and the map.
        removeTargets.forEach((elem) => {
            var index = this.targets.indexOf(elem);
            if (index >= 0) {
                let targetPath = elem.getSourceTargetPath();

                this.targets.splice(index,1);
                delete this.map[targetPath];

                if (removeFromGraph) {
                    // Remove targets from the dependency graph.
                    let rm = this.graph.removeConnectionGivenProduct(targetPath);

                    // Create a null connection for each source ancestor in the
                    // graph. This allows the original include target to be
                    // ignored in a subsequent build when no other dependencies
                    // have been loaded.
                    if (rm.length > 0) {
                        // Add null connections for the ancestors.
                        rm.forEach((depend) => {
                            this.graph.addNullConnection(depend);
                        });
                    }
                    else {
                        // If the node didn't have any ancestors (i.e. is its
                        // own ancestor), then we add a singular null connection
                        // to it so that it is ignored.
                        this.graph.addNullConnection(targetPath);
                    }
                }
            }
        });
    }

    /**
     * Resolves zero or more targets into a new target with the given path.
     *
     * @param {string} newTargetPath
     *  The target path. The final component in the path is the target
     *  name. Pass an empty value to avoid creating a new target.
     * @param {module:target~Target[]} removeTargets
     *  The list of targets to remove. This list may be empty.
     * @param {object} options
     * @param {boolean} options.isOutputTarget
     *  True if the resulting target is added as an output target. Default is
     *  true.
     * @param {boolean} options.removeFromGraph
     *  Parameter passed to context.removeTargets().
     *
     * @return {module:target~Target}
     *  A Target instance is only returned if a new target path was provided.
     */
    resolveTargets(newTargetPath,removeTargets,options) {
        // Normalize and unpack options.
        options = options || {};
        var { isOutputTarget, removeFromGraph } = options;
        isOutputTarget = (typeof isOutputTarget !== 'undefined') ? !!isOutputTarget : true;
        removeFromGraph = (typeof removeFromGraph !== 'undefined') ? !!removeFromGraph : false;

        if (removeTargets) {
            this.removeTargets(removeTargets,removeFromGraph);
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
     * Calls .pass() on a target and adds it to the set of output targets. The
     * old target is removed (if it was a current output target). This is the
     * preferred way to invoke .pass().
     *
     * @param {module:target~Target} target
     * @param {string} name
     * @param {string} path
     *
     * @return {module:target~Target}
     */
    passTarget(target,name,path) {
        const newTarget = target.pass(name,path);

        this.graph.addConnection(target.getSourceTargetPath(),
                                 newTarget.getSourceTargetPath());

        this.removeTargets(target);
        this.targets.push(newTarget);
        newTarget.setDeployPath(this.deployPath);

        return newTarget;
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
        plugin = resolve_deploy_plugin(plugin);
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
    async chain(nextPlugin,settings) {
        const plugin = resolve_deploy_plugin(nextPlugin);

        if (this.callbacks.beforeChain) {
            this.callbacks.beforeChain(this.currentPlugin,plugin);
        }

        this.currentPlugin = plugin;

        await plugin.exec(this,settings || {});

        if (this.callbacks.afterChain) {
            this.callbacks.afterChain(plugin);
        }
    }

    /**
     * Writes a cached property. The property is written to per-deployment
     * storage.
     *
     * @param {string} key
     * @param {*} value
     *
     * @return {Promise}
     */
    async writeCacheProperty(key,value) {
        this.tree.writeStorageConfig(this._makeCacheKey(key),value);
    }

    /**
     * Reads a cached property.
     *
     * @param {string} key
     *
     * @return {object}
     *  Returns the cached object, or null if it wasn't found.
     */
    async readCacheProperty(key) {
        return this.tree.getStorageConfig(this._makeCacheKey(key));
    }

    _makeCacheKey(key) {
        return format("cache.custom.%s",key);
    }
}

module.exports = DeployContext;

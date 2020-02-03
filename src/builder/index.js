/**
 * index.js
 *
 * @module builder
 */

const assert = require("assert");
const pathModule = require("path").posix;
const { format } = require("util");

const { BuildInclude } = require("./build-include");
const { BuildHandler } = require("./build-handler");
const targetModule = require("../target");
const pluginLoader = require("../plugins");
const audit = require("../audit");
const { WebdeployError } = require("../error");

const BUILDER_STATE_INITIAL = 0;
const BUILDER_STATE_FINALIZED = 1;

/**
 * Callback for new targets added during builder execution
 * @callback module:builder~Builder~newTargetCallback
 * @param {module:target~Target} target
 *  The target currently being processed by the builder.
 * @param {PLUGIN} plugin
 *  The build plugin of the currently-executing handler.
 * @param {module:target~Target[]} newTargets
 *  List of new targets created by current handler operation.
 */

/**
 * @typedef module:builder~Builder~builderCallbacks
 * @type {object}
 * @property {module:builder~Builder~newTargetCallback} newTarget
 */

/**
 * Encapsulates target building functionality.
 */
class Builder {
    /**
     * Creates a new builder. A builder audits, loads and executes build plugins
     * against targets loaded from the specified tree.
     *
     * @param {module:tree/path-tree~PathTree|module:tree/repo-tree~RepoTree} tree
     *  The tree used to load input targets for the build.
     * @param {object} options
     *  List of builder options
     * @param {string} options.type
     *  One of 'build' or 'deploy'.
     * @param {boolean} options.dev
     *  Determines if the builder skips non-development plugins; default is false
     * @param {module:depends~DependencyGraph} options.graph 
     *  The dependency graph to use for the run
     * @param {module:builder~Builder~builderCallbacks} [options.callbacks]
     *  Callbacks for the builder to invoke at various stages.
     */
    constructor(tree,options) {
        options.callbacks = options.callbacks || {};

        this.tree = tree;
        this.includes = [];
        this.options = options;
        this.plugins = {};
        this.targets = [];
        this.initial = [];
        this.outputTargets = [];
        this.state = BUILDER_STATE_INITIAL;
    }

    /**
     * Determines if the specified target is an initial target.
     *
     * @param {module:target~Target|string}
     *  The target to evaluate.
     *
     * @return {boolean}
     */
    isInitialTarget(target) {
        if (target instanceof targetModule.Target) {
            target = target.getSourceTargetPath();
        }

        return this.initial.some(x => { return x == target });
    }

    /**
     * Pushes include configuration objects on the instance.
     *
     * @param {object[]} includes
     *  List of raw build include objects to add to the builder.
     */
    pushIncludes(includes) {
        if (this.state != BUILDER_STATE_INITIAL) {
            throw new WebdeployError("Builder has invalid state: cannot push includes");
        }

        for (var i = 0;i < includes.length;++i) {
            var include = new BuildInclude((i+1).toString(),includes[i]);

            // Skip loading if not for build and we are doing a build run.
            if (this.options.type == "build" && !include.build) {
                continue;
            }

            this.includes.push(include);
        }
    }

    /**
     * Finalizes the builder to prepare it for execution. The builder will be
     * ready to execute once the auditor has completed auditing the build
     * plugins.
     *
     * @param {module:audit~PluginAuditor} auditor
     *  The auditor that will audit the plugins required for the build.
     */
    finalize(auditor) {
        if (this.state != BUILDER_STATE_INITIAL) {
            throw new WebdeployError("Builder has invalid state: cannot finalize");
        }

        var handlers = {}; // Store unique subset of all handlers.

        // Determine the list of plugins to keep for each include. Also compile
        // the unique set of plugins for the entire build.

        for (var i = 0;i < this.includes.length;++i) {
            var keep = [];
            var include = this.includes[i];

            for (var j = 0;j < include.handlers.length;++j) {
                var plugin = include.handlers[j];

                // Skip if plugin already loaded.
                if (plugin.id in handlers) {
                    keep.push(plugin);
                    continue;
                }

                if (!this.acceptsHandler(plugin)) {
                    continue;
                }

                keep.push(plugin);
                handlers[plugin.id] = plugin;
            }

            include.handlers = keep;
        }

        handlers = Object.values(handlers);

        // Audit plugins that are to be loaded.

        var plugins = handlers.filter((handler) => !!handler.loaderInfo)
            .map((handler) => handler.loaderInfo);

        auditor.addOrder(plugins, (results) => {
            // NOTE: The 'this.plugins' object stores both inline plugins and
            // global (i.e. audited) plugins. We do this locally so that we can
            // distinguish potential name collisions between inline and global
            // plugins.

            // Set plugins from results.

            for (let i = 0;i < results.length;++i) {
                var result = results[i];

                this.plugins[result.pluginId] = result.pluginObject;
            }

            // Create on-the-fly (i.e. inline) plugins for plugin objects
            // providing inline handlers.

            for (let i = 0;i < handlers.length;++i) {
                var plugin = handlers[i];

                if (plugin.handler) {
                    if (plugin.id in this.plugins) {
                        throw new WebdeployError(
                            format("Plugin '%s' is already defined: cannot define inline plugin handler",
                                   plugin.id)
                        );
                    }

                    this.plugins[plugin.id] = plugin.makeInlinePlugin();
                }
            }

            this.state = BUILDER_STATE_FINALIZED;

        }, (err) => {
            if (err instanceof WebdeployError) {
                return Promise.reject(format("Failed to audit build plugins: %s",err));
            }

            throw err;
        })
    }

    /**
     * Gets the number of plugins that were loaded by this builder.
     *
     * @return {number}
     */
    getPluginCount() {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        return Object.keys(this.plugins).length;
    }

    /**
     * Gets the first include object corresponding to a candidate target.
     *
     * @param {string} candidate
     *  The target path of a candidate target.
     *
     * @return {module:builder/build-include~BuildInclude}
     *  Returns the include object that was matched; otherwise false is
     *  returned.
     */
    findTargetInclude(candidate) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        var i = 0;
        while (i < this.includes.length) {
            if (this.includes[i].doesInclude(candidate)) {
                return this.includes[i];
            }

            i += 1;
        }

        return false;
    }

    /**
     * Determines if the builder can use the specified handler based on its
     * build configuration. This may exclude a handler if it doesn't fit the
     * current build settings such as 'dev' or 'build'.
     *
     * @param {object} handler
     *  The handler object that denotes the plugin.
     *
     * @return {boolean}
     */
    acceptsHandler(handler) {
        // Skip handler if dev and build settings do not align.
        if (!handler.dev && this.options.dev) {
            return false;
        }
        if (!handler.build && this.options.type == "build") {
            return false;
        }

        return true;
    }

    /**
     * Ensures the specified list of handlers can execute by loading their
     * required build plugins. You should only call this method after a builder
     * has been finalized. NOTE: the build plugins referenced in the handlers
     * must have already been audited, otherwise this method will throw an
     * exception!
     *
     * @param {object[]} handlers
     *  A list of handler objects.
     */
    ensureHandlers(handlers) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        for (let i = 0;i < handlers.length;++i) {
            let plugin = handlers[i];

            if (!this.acceptsHandler(plugin)) {
                continue;
            }

            if (plugin.id in this.plugins) {
                if (plugin.handler) {
                    throw new WebdeployError(
                        format("Plugin '%s' is already defined: cannot define inline plugin handler",
                               plugin.id)
                    );
                }
            }
            else {
                if (plugin.handler) {
                    this.plugins[plugin.id] = plugin.makeInlinePlugin();
                }
                else {
                    this.plugins[plugin.id] = audit.lookupBuildPlugin(plugin.loaderInfo);
                }
            }
        }
    }

    /**
     * Pushes an initial target into the builder's set of targets. This will
     * employ the builder's includes to determine the set of handlers for the
     * new target.
     *
     * @param {module:target~Target} newTarget
     *  The new target to add.
     * @param {boolean} force
     *  Forces the target to be added even if it doesn't match any of the
     *  builder's includes.
     *
     * @return {module:target~Target|boolean}
     *  Returns 'newTarget' upon success or false otherwise.
     */
    pushInitialTarget(newTarget,force) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        // Determine if the target is to be processed by the system if its path
        // matches an include defined in the target tree configuration.
        // Otherwise we only add the target if "force" is set.

        var include = this.findTargetInclude(newTarget.getSourceTargetPath());
        if (include) {
            newTarget.level = 1;
            newTarget.setHandlers(include.handlers.slice());
            newTarget.applyOptions(include.options);
            this.targets.push(newTarget);
            return newTarget;
        }

        if (force) {
            newTarget.level = 1;
            this.targets.push(newTarget);
            return newTarget;
        }

        return false;
    }

    /**
     * Pushes a new, initial output target having the specified sequence of
     * handlers. You can only call this on a finalized Builder.
     *
     * @param {module:target~Target} newTarget
     * @param {object[]} handlers
     *  The list of handlers to associate with the target.
     *
     * @return {module:target~Target}
     *  Returns 'newTarget'
     */
    pushInitialTargetWithHandlers(newTarget,handlers) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        handlers = handlers.map((settings,index) => new BuildHandler((index+1).toString(),settings));

        // Add the handler plugins if they are not currently in our list of
        // plugins. This also ensures the plugins have been audited.
        this.ensureHandlers(handlers);

        newTarget.level = 1;
        newTarget.setHandlers(handlers);
        this.targets.push(newTarget);

        return newTarget;
    }

    /**
     * Pushes a new, initial output target. The target is specified in delayed
     * form and is counted as an initial target from the loaded target
     * tree. Delayed targets should therefore only be used to indicate targets
     * loaded from the filesystem.
     *
     * @param {object} delayed
     *  A delayed target object.
     * @param {boolean} force
     *  Forces the target to be added even if it doesn't match any of the
     *  builder's includes.
     *
     * @return {module:target~Target|boolean}
     *  Returns 'newTarget' upon success or false otherwise.
     */
    pushInitialTargetDelayed(delayed,force) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        assert(typeof delayed == "object" && "path" in delayed
               && "name" in delayed && 'createStream' in delayed);

        var sourceTargetPath = pathModule.join(delayed.path,delayed.name);
        var include = this.findTargetInclude(sourceTargetPath);

        if (include) {
            // Resolve the delayed target information into a Target object.
            var newTarget = new targetModule.Target(
                delayed.path,
                delayed.name,
                delayed.createStream());

            newTarget.level = 1;
            newTarget.setHandlers(include.handlers.slice());
            newTarget.applyOptions(include.options);
            this.targets.push(newTarget);
            this.initial.push(sourceTargetPath);

            return newTarget;
        }

        if (force) {
            // Resolve the delayed target information into a Target object.
            var newTarget = new targetModule.Target(
                delayed.path,
                delayed.name,
                delayed.createStream());

            newTarget.level = 1;
            this.targets.push(newTarget);
            this.initial.push(sourceTargetPath);

            return newTarget;
        }

        return false;
    }

    /**
     * Creates a new target with content loaded from the tree associated with
     * the builder. You can only call this method on a finalized Builder.
     *
     * @param {string} path
     *  The path of the new target within the tree.
     *
     * @return {Promise<module:target~Target>}
     *  Returns a Promise that resolves to the new target.
     */
    pushInitialTargetFromTree(path) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        return this.tree.getBlob(path).then((blobStream) => {
            var parsed = pathModule.parse(path);
            var newTarget = new targetModule.Target(parsed.dir,parsed.base,blobStream);

            this.pushInitialTarget(newTarget,true);
            return newTarget;
        })
    }

    /**
     * Pushes a new output target given the specified parent target. This
     * creates a dependency inside the associated dependency graph.
     *
     * @param {module:target~Target} parentTarget
     *  The parent target used to inherit into the new target.
     * @param {module:target~Target} newTarget
     *  The new output target to push.
     *
     * @return {module:target~Target}
     *  Returns the new output target instance.
     */
    pushOutputTarget(parentTarget,newTarget) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        // Treat recursive targets as initial. This will ignore any outstanding
        // handlers.

        if (newTarget.recursive) {
            return this.pushInitialTarget(newTarget);
        }

        // If we have a dependency graph, add a connection.

        if (this.options.graph) {
            this.options.graph.addConnection(parentTarget.getSourceTargetPath(),
                                             newTarget.getSourceTargetPath());
        }

        // If the parentTarget has a non-empty list of handlers, then let the
        // newTarget reference the list of remaining handlers.

        if (parentTarget.handlers.length > 0) {
            // Let the newTarget inherit the remaining handlers from the parent
            // target. This allows for chaining handlers from the parent to the
            // child.
            newTarget.level = parentTarget.level + 1;
            if (newTarget !== parentTarget) {
                newTarget.setHandlers(parentTarget.handlers);
                delete parentTarget.handlers;
            }

            this.targets.push(newTarget);
            return newTarget;
        }

        // Otherwise the newTarget is an output target and is not processed by
        // the build system anymore.

        this.outputTargets.push(newTarget);
        return newTarget;
    }

    /**
     * Execute all available targets. This call only executes the first handler
     * for each target. Any remaining handlers are executed recursively by child
     * targets if at all. You can only call this method on a finalized Builder.
     *
     * @return {Promise}
     */
    execute() {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        var callback = (resolve,reject) => {
            var promises = [];

            while (this.targets.length > 0) {
                let target = this.targets.pop();

                // Ignore the target if it has no more handlers.
                if (!target.handlers || target.handlers.length == 0) {
                    this.outputTargets.push(target);
                    continue;
                }

                // Lookup next plugin to execute. Make sure it is included in
                // the set of loaded plugins before continuing. We ignore
                // unloaded plugins.
                let plugin;
                while (target.handlers.length > 0) {
                    var cand = target.handlers.shift();
                    if (cand.id in this.plugins) {
                        plugin = cand;
                        break;
                    }
                }
                if (!plugin) {
                    this.outputTargets.push(target);
                    continue;
                }

                // Apply any settings from the plugin handler to the target.
                target.applySettings(plugin);

                // Execute plugin.
                var promise = this.plugins[plugin.id].exec(target,plugin).then((newTargets) => {
                    if (newTargets) {
                        // Normalize newTargets into an array.
                        if (newTargets && !Array.isArray(newTargets)) {
                            newTargets = [newTargets];
                        }
                        else if (newTargets.length == 0) {
                            newTargets = null;
                        }

                        // Push targets into output lists.
                        for (var i = 0;i < newTargets.length;++i) {
                            this.pushOutputTarget(target,newTargets[i]);
                        }

                        if (this.options.callbacks.newTarget) {
                            this.options.callbacks.newTarget(target,plugin,newTargets);
                        }
                    }

                    // Make recursive call to execute any recursive targets.
                    return new Promise(callback);
                })

                promises.push(promise);
            }

            Promise.all(promises).then(resolve,reject);
        }

        return new Promise(callback);
    }
}

module.exports = {
    Builder
}

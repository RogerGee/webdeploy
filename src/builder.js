// builder.js

const assert = require("assert");
const pathModule = require("path").posix;

const targetModule = require("./target");
const pluginLoader = require("./plugins");
const audit = require("./audit");
const { WebdeployError } = require("./error");

const BUILDER_STATE_INITIAL = 0;
const BUILDER_STATE_FINALIZED = 1;

/**
 * Builder
 *
 * Encapsulates target building invocation.
 */
class Builder {
    /**
     * Creates a new builder. A builder audits, loads and executes build plugins
     * against targets loaded from the specified tree.
     *
     * @param Object tree      A RepoTree or PathTree instance
     * @param Object options       List of builder options
     * @param string options.type  One of "build" or "deploy"
     * @param Boolean options.dev  Indicates if running development build
     * @param DependencyGraph options.graph  The dependency graph for the run
     * @param Function options.callbacks.newTarget  Callback for new targets during execution
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

    // Determines if the specified target is an initial target. The 'target'
    // parameter may be a Target or a string.
    isInitialTarget(target) {
        if (target instanceof targetModule.Target) {
            target = target.getSourceTargetPath();
        }

        return this.initial.some(x => { return x == target });
    }

    // Pushes include configuration objects on the instance.
    pushIncludes(includes) {
        if (this.state != BUILDER_STATE_INITIAL) {
            throw new WebdeployError("Builder has invalid state: cannot push includes");
        }

        for (var i = 0;i < includes.length;++i) {
            var include = Object.assign({},includes[i]);

            // Apply defaults for core include object settings.
            if (typeof include.build == "undefined") {
                include.build = true;
            }
            if (!include.handlers) {
                include.handlers = [];
            }

            // Skip loading if not for build and we are doing a build run.
            if (this.options.type == "build" && !include.build) {
                continue;
            }

            this.includes.push(include);
        }
    }

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

                // If the plugin doesn't supply an inline handler, then we assume it
                // is to be loaded.
                if (!plugin.handler) {
                    plugin.loaderInfo = {
                        pluginId: plugin.id,
                        pluginVersion: plugin.version,
                        pluginKind: pluginLoader.PLUGIN_KINDS.BUILD_PLUGIN
                    }
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
                        throw new Error("Plugin '" + plugin.id + "' is already loaded; cannot load inline plugin");
                    }

                    this.plugins[plugin.id] = { exec: plugin.handler };
                }
            }

            this.state = BUILDER_STATE_FINALIZED;

        }, (err) => {
            if (err instanceof WebdeployError) {
                return Promise.reject("Failed to audit build plugins: " + err);
            }

            throw err;
        })
    }

    // Gets the number of plugins that were loaded by this builder.
    getPluginCount() {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        return Object.keys(this.plugins).length;
    }

    // Gets the include object corresponding to the candidate target. The
    // candidate target is just the target source path. Returns false if no
    // match was found.
    findTargetInclude(candidate) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        var i = 0;
        while (i < this.includes.length) {
            // Make sure the candidate is not excluded.

            if (this.includes[i].exclude) {
                if (Array.isArray(this.includes[i].exclude)) {
                    var excludes = this.includes[i].exclude;
                }
                else {
                    var excludes = [this.includes[i].exclude];
                }

                for (var j = 0;j < excludes.length;++j) {
                    if (candidate.match(excludes[j])) {
                        return false;
                    }
                }
            }

            // Try matches (exact match).

            if (this.includes[i].match) {
                if (Array.isArray(this.includes[i].match)) {
                    var matches = this.includes[i].match;
                }
                else {
                    var matches = [this.includes[i].match];
                }

                for (var j = 0;j < matches.length;++j) {
                    if (candidate == matches[j]) {
                        return this.includes[i];
                    }
                }
            }

            // Try patterns (regex match).

            if (this.includes[i].pattern) {
                if (Array.isArray(this.includes[i].pattern)) {
                    var patterns = this.includes[i].pattern;
                }
                else {
                    var patterns = [this.includes[i].pattern];
                }

                for (var j = 0;j < patterns.length;++j) {
                    if (candidate.match(patterns[j])) {
                        return this.includes[i];
                    }
                }
            }

            i += 1;
        }

        return false;
    }

    /**
     * Determines if the builder can use the specified handler based on its
     * build configuration. This may exclude a handler if it doesn't fit the
     * current build settings such as dev or build.
     *
     * @param Object handler
     *  The handler object that denotes the plugin.
     *
     * @return Boolean
     */
    acceptsHandler(handler) {
        // Apply defaults for core handler settings.
        if (typeof handler.dev === 'undefined') {
            handler.dev = false;
        }
        if (typeof handler.build === 'undefined') {
            handler.build = true;
        }

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
     * Adds plugin references to the builder so it can use plugins. The plugins
     * are denoted by the specified handler objects.
     *
     * @param Array handlers
     *  An array of handler objects.
     */
    addHandlers(handlers) {
        for (let i = 0;i < handlers.length;++i) {
            let plugin = handlers[i];

            if (!this.acceptsHandler(plugin)) {
                continue;
            }

            if (!(plugin.id in this.plugins)) {
                // Create inline plugin if needed.
                if (plugin.handler) {
                    this.plugins[plugin.id] = { exec: plugin.handler };
                }
                else {
                    let pluginInfo = {
                        pluginId: plugin.id,
                        pluginVersion: plugin.version
                    }

                    this.plugins[plugin.id] = audit.lookupBuildPlugin(pluginInfo);
                }
            }
        }
    }

    // Pushes an initial target into the builder's set of targets. This will
    // employ the builder's includes to determine the set of handlers for the
    // new target.
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
            newTarget.setHandlers(include.handlers.slice(0));
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

    // Pushes a new, initial output target having the specified sequence of
    // handlers.
    pushInitialTargetWithHandlers(newTarget,handlers) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        // Add the handler plugins if they are not currently in our list of
        // plugins.
        this.addHandlers(handlers);

        newTarget.level = 1;
        newTarget.setHandlers(handlers.slice());
        this.targets.push(newTarget);
        return newTarget;
    }

    // Pushes a new, initial output target. The target is specified in delayed
    // form and is counted as an initial target from the loaded target
    // tree. Delayed targets should therefore only be used to indicate targets
    // loaded from the filesystem.
    pushInitialTargetDelayed(delayed,force) {
        if (this.state != BUILDER_STATE_FINALIZED) {
            throw new WebdeployError("Builder has invalid state: not finalized");
        }

        assert(typeof delayed == "object" && "path" in delayed
               && "name" in delayed && 'createStream' in delayed);

        // Resolve the delayed target information into a Target object.
        var newTarget = new targetModule.Target(delayed.path,
                                                delayed.name,
                                                delayed.createStream());

        // Push target. If it was accepted, then count the target as initial.
        var result = this.pushInitialTarget(newTarget,force);
        if (result) {
            this.initial.push(newTarget.getSourceTargetPath());
        }

        return result;
    }

    // Creates a new target with content loaded from the tree targeted by the
    // build process. This method returns a Promise that resolves to the new
    // Target.
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

    // Pushes a new output target given the specified parent target.
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

    // Execute all available targets. Only execute the first specified
    // handler. Any remaining handlers are executed recursively by child targets
    // if at all.
    //
    // Returns Promise
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

module.exports = Builder;

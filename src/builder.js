// builder.js

const assert = require("assert");
const pathModule = require("path").posix;
const targetModule = require("./target");
const pluginLoader = require("./plugins");

/**
 * Builder
 *
 * Encapsulates target building invocation.
 */
class Builder {
    // Creates a new builder. The builder loads plugins available from the
    // specified set of includes. The options object contains global build
    // options. The callback is to handle the addition of new targets into the
    // build system.
    //
    // Options:
    //   -type: "build" or "deploy"
    //   -dev: Boolean
    //   -graph: DependencyGraph
    constructor(options,callback) {
        this.options = options;
        this.plugins = {};
        this.includes = [];
        this.targets = [];
        this.outputTargets = [];
        this.callback = callback;
    }

    // Loads the plugins associated with the set of handlers. Some handlers are
    // ignored due to builder options (e.g. dev/type). The method returns the
    // revised set of handlers.
    loadHandlerPlugins(handlers) {
        var keep = [];

        for (var i = 0;i < handlers.length;++i) {
            var plugin = handlers[i];

            // Skip if plugin already loaded.
            if (plugin.id in this.plugins) {
                keep.push(handlers[i]);
                continue;
            }

            // Apply defaults for core plugin settings.
            if (typeof plugin.dev === 'undefined') {
                plugin.dev = false;
            }
            if (typeof plugin.build === 'undefined') {
                plugin.build = true;
            }

            // Skip plugin if dev and build settings do not align.
            if (!plugin.dev && this.options.dev) {
                continue;
            }
            if (!plugin.build && this.options.type == "build") {
                continue;
            }

            if (plugin.handler) {
                this.plugins[plugin.id] = { exec: plugin.handler };
            }
            else {
                this.plugins[plugin.id] = pluginLoader.loadBuildPlugin(plugin.id);
            }

            keep.push(handlers[i]);
        }

        return keep;
    }

    // Sets the include objects on the instance. This also will load all plugins
    // referenced by the include objects' handler lists. The method may exclude
    // some rules depending on the builder options.
    setIncludes(includes) {
        var keep = [];

        for (var i = 0;i < includes.length;++i) {
            var include = includes[i];

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

            include.handlers = this.loadHandlerPlugins(include.handlers);
            keep.push(include);
        }

        this.includes = keep;
    }

    // Gets the number of plugins that were loaded by this builder.
    getPluginCount() {
        return Object.keys(this.plugins).length;
    }

    // Gets the include object corresponding to the candidate target. The
    // candidate target is just the target source path. Returns false if no
    // match was found.
    findTargetInclude(candidate) {
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

    // Pushes an initial target into the builder's set of targets. This will
    // employ the builder's includes to determine the set of handlers for the
    // new target. The target may be specified as a Target object via
    // "newTarget" or as a delayed target object via "delayed".
    pushInitialTarget(newTarget,delayed) {
        // The target may only exist in a delayed state if 'newTarget' is not
        // set, in that case the required information exists in "delayed".
        if (!newTarget) {
            assert(typeof delayed == "object" && "path" in delayed
                   && "name" in delayed && 'createStream' in delayed);

            var candidate = pathModule.join(delayed.path,delayed.name);
        }
        else {
            var candidate = newTarget.getSourceTargetPath();
        }

        // Determine if the target is to be processed by the system. We only add
        // it if so.
        var include = this.findTargetInclude(candidate);
        if (include) {
            if (!newTarget) {
                // Resolve the delayed target information into a Target object.
                newTarget = new targetModule.Target(delayed.path,
                                                    delayed.name,
                                                    delayed.createStream(),
                                                    include.options);
            }

            newTarget.level = 1;
            newTarget.setHandlers(include.handlers.slice(0));
            this.targets.push(newTarget);
            return newTarget;
        }

        return false;
    }

    // Pushes a new output target given the specified parent target.
    pushOutputTarget(parentTarget,newTarget) {
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

                        this.callback(target,plugin,newTargets);
                    }

                    // Make recursive call to execute any recursive targets.
                    return new Promise(callback);
                });

                promises.push(promise);
            }

            Promise.all(promises).then(resolve,reject);
        };

        return new Promise(callback);
    }
}

module.exports = {
    Builder: Builder
};

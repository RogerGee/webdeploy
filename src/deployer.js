// deployer.js

const assert = require("assert");
const pathModule = require("path").posix;
const git = require("nodegit");
const treeLoader = require("./tree");
const pluginLoader = require("./plugins");
const targetModule = require("./target");
const contextModule = require("./context");
const depends = require("./depends");
const logger = require("./logger");

const DEPLOY_TYPES = {
    // Uses the config's "build" deployment.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" deployment.
    TYPE_DEPLOY: 'deploy'
};

function deployDeployStep(tree,options,targets) {
    logger.log("Deploying targets: _" + options.deployPlugin.id + "_");

    if (targets.length == 0) {
        if (options.ignored) {
            logger.pushIndent();
            if (options.type == DEPLOY_TYPES.TYPE_BUILD) {
                logger.log("*All Targets Ignored - Build Up-to-date*");
            }
            else {
                logger.log("*All Targets Ignored - Deployment Up-to-date*");
            }
            logger.popIndent();
            return Promise.resolve();
        }

        throw new Error("No targets for deploy step!");
    }

    if (!options.deployPlugin) {
        throw new Error("No deploy plugin for deploy step!");
    }

    if (!options.deployPath) {
        throw new Error("No deploy path for deploy step!");
    }

    var context = new contextModule.DeployContext(options.deployPath,targets);
    var plugin = pluginLoader.loadDeployPlugin(options.deployPlugin.id);

    // Hijack chain() method so we can log messages.

    context.chain = function(nextPlugin) {
        logger.popIndent();
        logger.log("Chain deploy _" + options.deployPlugin.id + "_ -> _" + nextPlugin + "_");
        logger.pushIndent();
        contextModule.DeployContext.prototype.chain(nextPlugin);
    };

    logger.pushIndent();
    var promise = plugin.exec(context,options.deployPlugin);
    logger.popIndent();

    return promise;
}

function deployBuildStep(tree,options) {
    var includes;             // include rules for target analysis (to be set later)
    var plugins = {};         // plugins available for build
    var targets = [];         // targets processed by build plugins
    var outputTargets = [];   // targets to be processed by deploy plugin

    function findTargetInclude(candidate) {
        var i = 0;
        while (i < includes.length) {
            // Try matches (exact match).

            if (includes[i].match) {
                if (Array.isArray(includes[i].match)) {
                    var matches = includes[i].match;
                }
                else {
                    var matches = [includes[i].match];
                }

                for (var j = 0;j < matches.length;++j) {
                    if (candidate == matches[j]) {
                        return includes[i];
                    }
                }
            }

            // Try patterns (regex match).

            if (includes[i].pattern) {
                if (Array.isArray(includes[i].pattern)) {
                    var patterns = includes[i].pattern;
                }
                else {
                    var patterns = [includes[i].pattern];
                }

                for (var j = 0;j < patterns.length;++j) {
                    if (candidate.match(patterns[j])) {
                        return includes[i];
                    }
                }
            }

            i += 1;
        }

        return false;
    }

    // Create a function for adding output targets to the global arrays.
    function pushOutputTarget(parentTarget,newTarget,initial) {
        if (typeof initial == "undefined") {
            // Treat recursive targets as initial targets.
            initial = newTarget.recursive;
        }

        // If the push is for an initial target, then determine if the target is
        // included in the set of processed targets.

        if (initial) {
            // The target may only exist in a delayed state if 'newTarget' is
            // not set, in that case the required information exists in
            // "initial".
            if (!newTarget) {
                assert(typeof initial == "object" && "path" in initial
                       && "name" in initial && 'createStream' in initial);

                var candidate = pathModule.join(initial.path,initial.name);
            }
            else {
                var candidate = newTarget.getSourceTargetPath();
            }

            var include = findTargetInclude(candidate);
            if (include) {
                if (!newTarget) {
                    // Resolve the delayed target information into a Target object.
                    newTarget = new targetModule.Target(initial.path,initial.name,initial.createStream(),include.options);
                }
                newTarget.level = 1;
                newTarget.handlers = include.handlers.slice(0);
                targets.push(newTarget);

                logger.log("add _" + candidate + "_");
            }

            return;
        }

        // If the parentTarget has a non-empty list of handlers, then let the
        // newTarget reference the list of remaining handlers.

        assert(parentTarget);

        if (options.graph) {
            options.graph.addConnection(parentTarget.getSourceTargetPath(),
                                        newTarget.getSourceTargetPath());
        }

        if (parentTarget.handlers.length > 0) {
            // Let the newTarget inherit the remaining handlers from the parent
            // target. This allows for chaining handlers from the parent to the
            // child.
            newTarget.level = parentTarget.level + 1;
            if (newTarget !== parentTarget) {
                newTarget.handlers = parentTarget.handlers;
                delete parentTarget.handlers;
            }

            targets.push(newTarget);
            return;
        }

        // Otherwise the newTarget is an output target and is not processed by
        // the build system anymore.

        outputTargets.push(newTarget);
    }

    return tree.getConfigParameter("info").then((configInfo) => {
        logger.log("Loaded build config from _" + configInfo.file + "_");
        return tree.getConfigParameter("includes");
    }).then((_includes) => {
        // Load build plugins required by this deployment.

        var n = 0;
        includes = _includes; // set outer-scoped variable

        for (var i = 0;i < includes.length;++i) {
            for (var j = 0;j < includes[i].handlers.length;++j) {
                var plugin = includes[i].handlers[j];

                // Skip if plugin already loaded.
                if (plugin.id in plugins) {
                    continue;
                }

                if (typeof plugin.dev === 'undefined') {
                    plugin.dev = true;
                }
                if (typeof plugin.build === 'undefined') {
                    plugin.build = true;
                }

                // Skip if in dev mode and plugin is not for dev OR if the
                // plugin cannot be used in build.
                if (!plugin.dev && options.dev) {
                    includes[i].handlers[j] = null;
                    continue;
                }
                if (!plugin.build && options.type == DEPLOY_TYPES.TYPE_BUILD) {
                    includes[i].handlers[j] = null;
                    continue;
                }

                n += 1;

                if (plugin.handler) {
                    plugins[plugin.id] = { exec: plugin.handler };
                }
                else {
                    plugins[plugin.id] = pluginLoader.loadBuildPlugin(plugin.id);
                }
            }

            includes[i].handlers = includes[i].handlers.filter((x) => { return x !== null; });
            if (includes[i].handlers.length == 0) {
                includes[i] = null;
            }
        }

        includes = includes.filter((x) => { return x !== null; });

        logger.log("Loaded _" + n + "_ build " + logger.plural(n,"plugin"));

        // Calculate the set of ignored targets given a dependency graph.
        // Otherwise return an empty set.

        if (options.graph && options.graph.isLoaded()) {
            return options.graph.getIgnoreSources(tree);
        }

        return Promise.resolve(new Set());
    }).then((ignoreSet) => {
        // Load set of initial targets from tree.

        logger.log("Adding targets:");
        logger.pushIndent();

        // Flag whether any targets were ignored so we can later determine what
        // it means to have zero targets.
        options.ignored = false;

        var targetPromises = [];

        return tree.walk((path,name,createInputStream) => {
            var relativePath = pathModule.relative(options.buildPath,path);
            var ref = pathModule.join(relativePath,name);

            // Ignore potential targets that were determined to not belong in
            // the build since they map to build products that are already
            // up-to-date.

            if (ignoreSet.has(ref)) {
                options.ignored = true;
                return;
            }

            function addTarget(isModified) {
                if (!isModified) {
                    return;
                }

                // Create a candidate target and attempt to add it.
                var delayedTarget = {
                    path: relativePath,
                    name: name,
                    createStream: createInputStream
                };

                pushOutputTarget(null,null,delayedTarget);
            }

            // If a potential target does not have a build product (i.e. is a
            // trivial product), then check to see if it is modified and should
            // be included or not.

            if (options.graph && !options.graph.hasProductForSource(ref)) {
                targetPromises.push(tree.isBlobModified(ref).then(addTarget));
            }
            else {
                addTarget(true);
            }
        }, (path) => {
            // Ignore any hidden paths.
            if (path[0] == ".") {
                return false;
            }

            return true;
        }).then(() => {
            return Promise.all(targetPromises);
        });
    }).then(() => {
        // Send each target through each plugin.

        if (targets.length == 0) {
            logger.log("*No Targets*");
        }

        logger.popIndent();
        logger.log("Building targets:");

        if (targets.length == 0) {
            logger.pushIndent();
            logger.log("*No Targets*");
            logger.popIndent();
        }

        return new Promise((resolve,reject) => {
            var recursion = 0;

            function execTargets() {
                // Execute all available targets. Only execute the first
                // specified handler. Any remaining handlers are executed
                // recursively by child targets if at all.

                while (targets.length > 0) {
                    let target = targets.pop();

                    // Ignore the target if it has no more handlers.
                    if (!target.handlers || target.handlers.length == 0) {
                        outputTargets.push(target);
                        continue;
                    }

                    // Lookup next plugin to execute. Make sure it is included
                    // in the set of loaded plugins before continuing. We ignore
                    // unloaded plugins.
                    let plugin;
                    while (target.handlers.length > 0) {
                        var cand = target.handlers.shift();
                        if (cand.id in plugins) {
                            plugin = cand;
                            break;
                        }
                    }
                    if (!plugin) {
                        outputTargets.push(target);
                        continue;
                    }

                    // Apply any settings from the plugin handler to the target.
                    target.applySettings(plugin);

                    recursion += 1;
                    plugins[plugin.id].exec(target,plugin).then((newTargets) => {
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
                                pushOutputTarget(target,newTargets[i]);
                            }

                            // Print logging messages.
                            logger.pushIndent(target.level);
                            if (newTargets) {
                                var prefix = "exec _" + target.targetName + "_"
                                    + " -> *" + plugin.id + "* -> ";

                                newTargetNames = newTargets.map((x) => { return x.targetName; });
                                logger.log(prefix + "_" + newTargetNames[0] + "_");
                                for (var j = 1;j < newTargetNames.length;++j) {
                                    logger.log(" ".repeat(prefix.length - 7) + "-> _"
                                               + newTargetNames[j] + "_");
                                }
                            }
                            logger.popIndent(target.level);
                        }

                        recursion -= 1;
                        execTargets();
                    }).catch(reject);
                }

                // If this is the last recursion, call the deploy step.
                if (recursion == 0) {
                    deployDeployStep(tree,options,outputTargets).then(resolve,reject);
                }
            }

            execTargets();
        });
    });
}

function deployStartStep(tree,options) {
    assert(options.type == DEPLOY_TYPES.TYPE_BUILD
           || options.type == DEPLOY_TYPES.TYPE_DEPLOY);

    // Obtain the deploy plugin name.

    return tree.getConfigParameter(options.type).then((deployPlugin) => {
        if (typeof deployPlugin !== "object") {
            throw new Error("Config parameter '" + options.type + "' must be a plugin object");
        }
        if (!deployPlugin.id) {
            throw new Error("Config parameter '" + options.type + "' must have plugin id");
        }

        options.deployPlugin = deployPlugin;

        // Load up any extra deploy plugin options from the git-config.

        return tree.getConfigSection(deployPlugin.id);
    }).then((sectionConfig) => {
        // Augment existing plugin object with discovered config section.
        var keys = Object.keys(sectionConfig);
        for (var i = 0;i < keys.length;++i) {
            asset(keys[i] != "id");
            options.deployPlugin[keys[i]] = sectionConfig[keys[i]];
        }

        // Set build path. RepoTrees will return an empty string.

        options.buildPath = tree.getPath();
        if (!options.buildPath) {
            options.buildPath = "";
        }

        // Load up dependency graph.

        return depends.loadFromTree(tree);
    }).then((graph) => {
        options.graph = graph;

        if (options.force) {
            options.graph.reset();
        }

        // Obtain the deploy path. For TYPE_BUILD deployments, this is always
        // the same as the build path. For TYPE_DEPLOY deployments, this is
        // obtained from the configuration. Then execute the build pipe to begin
        // the pipeline.

        return new Promise((resolve,reject) => {
            if (options.type == DEPLOY_TYPES.TYPE_BUILD) {
                options.deployPath = options.buildPath;
                deployBuildStep(tree,options)
                    .then(resolve,reject);
            }
            else {
                tree.getConfigParameter("deployPath").then((configParam) => {
                    options.deployPath = configParam;
                    return deployBuildStep(tree,options);
                },reject).then(resolve,reject);
            }
        });
    }).then(() => {
        // Save the dependency graph if available.
        if (options.graph) {
            return depends.saveToTree(tree,options.graph);
        }
    }).then(() => {
        if (tree.name == 'RepoTree') {
            return tree.saveDeployCommit();
        }
    });
}

// Initiates a deployment using the specified git-repository. The "options"
// object must contains a "type" property corresponding to one of the
// DEPLOY_TYPES.
function deployRepository(repo,options) {
    return treeLoader.createRepoTree(repo).then((tree) => {
        return deployStartStep(tree,options);
    });
}

// Initiates a deployment using the files/directories from the local
// filesystem. The "options" object must contains a "type" property
// corresponding to one of the DEPLOY_TYPES.
function deployLocal(path,options) {
    return treeLoader.createPathTree(path).then((tree) => {
        return deployStartStep(tree,options);
    });
}

// Initiates a deployment, deciding whether or not to use a local directory or a
// git-repository depending on the contents of "path".
function deployDecide(path,options,decideCallback) {
    return git.Repository.discover(path,0,pathModule.resolve(pathModule.join(path,"..")))
        .then((repoPath) => {
            decideCallback("repo");
            return deployRepository(repoPath,options);
        },(err) => {
            decideCallback("local");
            return deployLocal(path,options);
        });
}

module.exports = {
    deployRepository: deployRepository,
    deployLocal: deployLocal,
    deployDecide: deployDecide,

    types: DEPLOY_TYPES
};

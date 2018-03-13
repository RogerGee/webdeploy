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
    logger.log("Deploying targets: _" + options.deployPlugin + "_");

    if (targets.length == 0) {
        if (options.ignored) {
            logger.pushIndent();
            logger.log("*All Targets Ignored - Build Up-to-date*");
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
    var plugin = pluginLoader.loadDeployPlugin(options.deployPlugin);

    // Hijack chain() method so we can log messages.

    context.chain = function(nextPlugin) {
        logger.popIndent();
        logger.log("Chain deploy _" + options.deployPlugin + "_ -> _" + nextPlugin + "_");
        logger.pushIndent();
        contextModule.DeployContext.prototype.chain(nextPlugin);
    }

    logger.pushIndent();
    var promise = plugin.exec(context);
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
            if (candidate.match(includes[i].pattern)) {
                return includes[i];
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
                    newTarget = new targetModule.Target(initial.path,initial.name,initial.createStream());
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

                // Skip if in dev mode and plugin is not for dev.
                if (!plugin.dev && options.dev) {
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
        }

        logger.log("Loaded _" + n + "_ build " + logger.plural(n,"plugin"));

        // Calculate the set of ignored targets given a dependency graph.
        // Otherwise return an empty set.

        if (options.graph && options.graph.isLoaded()) {
            return options.graph.getIgnoreSources(options.buildPath);
        }

        return Promise.resolve(new Set());
    }).then((ignoreSet) => {
        // Load set of initial targets from tree. Only include the blobs that
        // match an include object's pattern and that are not ignored by the
        // build configuration.

        logger.log("Adding targets:");
        logger.pushIndent();

        // Flag whether any targets were ignored so we can later determine what
        // it means to have zero targets.
        options.ignored = false;

        return tree.walk((path,name,createInputStream) => {
            var relativePath = pathModule.relative(options.buildPath,path);
            var ref = pathModule.join(relativePath,name);

            if (ignoreSet.has(ref)) {
                options.ignored = true;
                return;
            }

            // Create a candidate target and attempt to add it.
            var delayedTarget = {
                path: relativePath,
                name: name,
                createStream: createInputStream
            };

            pushOutputTarget(null,null,delayedTarget);
        }, (path) => {
            // Ignore any hidden paths.
            if (path[0] == ".") {
                return false;
            }

            return true;
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
        options.deployPlugin = deployPlugin;
        options.buildPath = tree.getPath();
        if (!options.buildPath) {
            options.buildPath = "";
        }

        // Load up dependency graph if in build mode.

        if (options.type == DEPLOY_TYPES.TYPE_BUILD) {
            options.graph = depends.loadFromFile(options.buildPath);
        }

        // Obtain the deploy path. For TYPE_BUILD deployments, this is always
        // the same as the build path. For TYPE_DEPLOY deployments, this is
        // obtained from the configuration.

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
    }).then((val) => {
        // Save the dependency graph if available.
        if (options.graph) {
            depends.saveToFile(options.buildPath,options.graph);
        }

        return val;
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

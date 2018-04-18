// deployer.js

const assert = require("assert");
const pathModule = require("path").posix;
const git = require("nodegit");
const treeLoader = require("./tree");
const pluginLoader = require("./plugins");
const targetModule = require("./target");
const contextModule = require("./context");
const builderModule = require("./builder");
const depends = require("./depends");
const logger = require("./logger");

const DEPLOY_TYPES = {
    // Uses the config's "build" deployment.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" deployment.
    TYPE_DEPLOY: 'deploy'
};

function deployDeployStep(tree,builder,options) {
    logger.log("Deploying targets: _" + options.deployPlugin.id + "_");

    if (builder.outputTargets.length == 0) {
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

        logger.pushIndent();
        logger.log("No targets to build");
        logger.popIndent();
        return Promise.resolve();
    }

    if (!options.deployPlugin) {
        throw new Error("No deploy plugin for deploy step!");
    }

    if (!options.deployPath) {
        throw new Error("No deploy path for deploy step!");
    }

    var context = new contextModule.DeployContext(options.deployPath,builder);
    var plugin = pluginLoader.loadDeployPlugin(options.deployPlugin.id);

    // Hijack chain() method so we can log messages.

    context.chain = function(nextPlugin,settings) {
        logger.log("Chain deploy _" + options.deployPlugin.id + "_ -> _" + nextPlugin + "_");
        logger.pushIndent();
        return contextModule.DeployContext.prototype.chain.call(context,nextPlugin,settings).then((retval) => {
            logger.popIndent();
            return retval;
        });
    };

    logger.pushIndent();
    return plugin.exec(context,options.deployPlugin).then((retval) => {
        logger.popIndent();

        return retval;
    });
}

function deployBuildStep(tree,options) {
    var builder;
    var targetBasePath = "";

    function printNewTargets(target,plugin,newTargets) {
        if (newTargets.length > 0) {
            logger.pushIndent(target.level);
            var prefix = "exec _" + target.targetName + "_"
                + " -> *" + plugin.id + "* -> ";

            newTargetNames = newTargets.map((x) => { return x.targetName; });
            logger.log(prefix + "_" + newTargetNames[0] + "_");
            for (var j = 1;j < newTargetNames.length;++j) {
                logger.log(" ".repeat(prefix.length - 7) + "-> _"
                           + newTargetNames[j] + "_");
            }
            logger.popIndent(target.level);
        }
    }

    return tree.getConfigParameter("info").then((configInfo) => {
        logger.log("Loaded target tree config from _" + configInfo.file + "_");

        // Load base path from config. This config parameter is optional.

        return tree.getConfigParameter("basePath").then(theBasePath => {
            targetBasePath = theBasePath;
        }, e => {});
    }).then(() => {
        return tree.getConfigParameter("includes");
    }).then((includes) => {
        // Load builder required for this deployment.

        builder = new builderModule.Builder(options,printNewTargets);
        builder.setIncludes(includes);

        var n = builder.getPluginCount();
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
            // Normalize path relative to configured target base path.
            if (targetBasePath) {
                path = pathModule.relative(targetBasePath,path);
            }

            var relativePath = pathModule.relative(options.buildPath,path);
            var ref = pathModule.join(relativePath,name);

            // Ignore potential targets that were determined to not belong in
            // the build since they map to build products that are already
            // up-to-date.

            if (ignoreSet.has(ref)) {
                options.ignored = true;
                return;
            }

            // Create a delayed target object and attempt to add it to the
            // builder.
            var delayedTarget = {
                path: relativePath,
                name: name,
                createStream: createInputStream
            };

            // If a potential target does not have a build product (i.e. is a
            // trivial product), then check to see if it is modified and should
            // be included or not.

            if (!options.force && options.graph && !options.graph.hasProductForSource(ref)) {
                var realRef = pathModule.join(targetBasePath,ref);
                targetPromises.push(tree.isBlobModified(realRef).then((result) => {
                    if (result) {
                        var newTarget = builder.pushInitialTarget(null,delayedTarget);
                        if (newTarget) {
                            logger.log("add _" + newTarget.getSourceTargetPath() + "_");
                        }
                    }
                    else {
                        options.ignored = true;
                    }
                }));
            }
            else {
                var newTarget = builder.pushInitialTarget(null,delayedTarget);
                if (newTarget) {
                    logger.log("add _" + newTarget.getSourceTargetPath() + "_");
                }
            }
        }, {
            filter: (path) => {
                // Ignore any hidden paths.
                if (path[0] == ".") {
                    return false;
                }

                return true;
            },
            basePath: targetBasePath
        }).then(() => {
            return Promise.all(targetPromises);
        });
    }).then(() => {
        if (builder.targets.length == 0) {
            logger.log("*No Targets*");
        }

        // Send each target through each plugin.

        logger.popIndent();
        logger.log("Building targets:");

        if (builder.targets.length == 0) {
            logger.pushIndent();
            logger.log("*No Targets*");
            logger.popIndent();
        }

        return builder.execute();
    }).then(() => {
        return deployDeployStep(tree,builder,options);
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

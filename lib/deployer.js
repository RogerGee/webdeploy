// deployer.js

const assert = require("assert");
const pathModule = require("path");
const git = require("nodegit");
const treeLoader = require("./tree.js");
const pluginLoader = require("./plugins.js");
const targetModule = require("./target.js");
const contextModule = require("./context.js");
const logger = require("./logger.js");

const DEPLOY_TYPES = {
    // Uses the config's "build" deployment.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" deployment.
    TYPE_DEPLOY: 'deploy'
};

function deployDeployStep(tree,options,targets) {
    if (targets.length == 0) {
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

    logger.log("Deploying targets: _" + options.deployPlugin + "_");
    logger.pushIndent();
    plugin.exec(context);
    logger.popIndent();
}

function deployBuildStep(tree,options) {
    var plugins = {};
    var targets = [];
    var outputTargets = [];

    return tree.getConfigParameter("builders").then((builders) => {
        // Load build plugins required by this deployment.

        for (var i = 0;i < builders.length;++i) {
            if (builders[i].handler) {
                plugins[builders[i].plugin] = { exec: builders[i].handler };
            }
            else {
                plugins[builders[i].plugin] = pluginLoader.loadBuildPlugin(builders[i].plugin);
            }
        }

        logger.log("Loaded _" + builders.length + "_ build " + logger.plural(builders.length,"plugin"));

        return tree.getConfigParameter("includes");
    }).then((includes) => {
        // Load set of initial targets from tree. Only include the blobs that
        // match an include object's pattern.

        logger.log("Adding targets:");
        logger.pushIndent();

        return tree.walk((path,name,input) => {
            var candidate = pathModule.join(path,name);
            var relativePath = pathModule.relative(options.buildPath,path);

            for (var i = 0;i < includes.length;++i) {
                if (candidate.match(includes[i].pattern)) {
                    var info = {
                        include: includes[i],
                        push: (target,recursive) => {
                            if (recursive) {
                                // Set the target in the original list so it is
                                // processed again.
                                targets.push(target);
                            }
                            else {
                                outputTargets.push(target);
                            }
                        }
                    };

                    var target = new targetModule.Target(relativePath,name,input,info);
                    targets.push(target);
                    logger.log("add _" + pathModule.join(relativePath,name) + "_");
                }
            }
        }, (path) => {
            // Ignore any hidden paths.
            if (path[0] == ".") {
                return false;
            }

            return true;
        });
    }).then(() => {
        // Send each target through each plugin.

        logger.popIndent();
        logger.log("Building targets:");

        return new Promise((resolve,reject) => {
            var recursion = 0;
            var pluginIds = Object.keys(plugins);

            function execTargets() {
                // Execute all available targets.
                while (targets.length > 0) {
                    let nextTarget = targets.pop();

                    for (var i = 0;i < pluginIds.length;++i) {
                        let pluginId = pluginIds[i];

                        recursion += 1;
                        plugins[pluginId].exec(nextTarget).then((newTargetNames) => {
                            if (newTargetNames && !Array.isArray(newTargetNames)) {
                                newTargetNames = [newTargetNames];
                            }
                            else if (newTargetNames.length == 0) {
                                newTargetNames = null;
                            }

                            if (newTargetNames) {
                                var prefix = "exec _" + nextTarget.targetName + "_"
                                    + " -> *" + pluginId + "* -> ";

                                newTargetNames = newTargetNames.map((x) => { return x.targetName; });

                                logger.log(prefix + "_" + newTargetNames[0] + "_");
                                for (var j = 1;j < newTargetNames.length;++j) {
                                    logger.log(" ".repeat(prefix.length - 7) + "-> _"
                                               + newTargetNames[j] + "_");
                                }
                            }

                            recursion -= 1;
                            execTargets();
                        }, reject);
                    }
                }

                // If this is the last recursion, call the deploy step.
                if (recursion == 0) {
                    logger.popIndent();
                    deployDeployStep(tree,options,outputTargets).then(resolve,reject);
                }
            };

            logger.pushIndent();
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

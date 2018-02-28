// deployer.js

const assert = require("assert");
const pathModule = require("path");
const treeLoader = require("./tree.js");
const pluginLoader = require("./plugins.js");
const targetModule = require("./target.js");
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

    if (!options.deployPath) {
        throw new Error("No deploy path for deploy step!");
    }

}

function deployBuildStep(tree,options) {
    var plugins = {};
    var targets = [];
    var outputTargets = [];

    return tree.getConfigParameter("builders").then((builders) => {
        // Load build plugins required by this deployment.

        for (var i = 0;i < builders.length;++i) {
            plugins[builders[i].plugin] = pluginLoader.loadBuildPlugin(builders[i].plugin);
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

            for (var i = 0;i < includes.length;++i) {
                if (candidate.match(includes[i].pattern)) {
                    logger.log("add _" + candidate + "_");

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

                    var target = new targetModule.Target(path,name,input,info);
                    targets.push(target);
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
        logger.pushIndent();

        while (targets.length > 0) {
            var nextTarget = targets.pop();
            var keys = Object.keys(plugins);

            for (var i = 0;i < keys.length;++i) {
                var pluginId = keys[i];
                var newTargetNames = plugins[pluginId].exec(nextTarget);
                if (newTargetNames && !Array.isArray(newTargetNames)) {
                    newTargetNames = [newTargetNames];
                }
                else if (newTargetNames.length == 0) {
                    newTargetNames = null;
                }

                if (newTargetNames) {
                    var prefix = "exec _" + nextTarget.targetName + "_"
                        + " -> *" + pluginId + "* -> ";

                    logger.log(prefix + "_" + newTargetNames[0] + "_");
                    for (var j = 1;j < newTargetNames.length;++j) {
                        logger.log(" ".repeat(prefix.length - 7) + "-> _"
                                   + newTargetNames[j] + "_");
                    }
                }
            }
        }

        logger.popIndent();

        return deployDeployStep(tree,options,outputTargets);
    });
}

function deployStartStep(tree,options) {
    assert(options.type == DEPLOY_TYPES.TYPE_BUILD
           || options.type == DEPLOY_TYPES.TYPE_DEPLOY);

    // Obtain the deploy plugin name.

    return tree.getConfigParameter(options.type).then((deployPlugin) => {
        options.deployPlugin = deployPlugin;

        // Obtain the deploy path. For TYPE_BUILD deployments, this is always
        // the same as the build path. For TYPE_DEPLOY deployments, this is
        // obtained from the configuration.

        return new Promise((resolve,reject) => {
            if (options.type == DEPLOY_TYPES.TYPE_BUILD) {
                options.deployPath = tree.getPath();
                deployBuildStep(tree,options)
                    .then(resolve,reject);
            }
            else {
                tree.getConfigParameter("deploy-path").then((configParam) => {
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

module.exports = {
    deployRepository: deployRepository,
    deployLocal: deployLocal,

    types: DEPLOY_TYPES
};

// deployer.js

const pathModule = require("path");
const treeLoader = require("./tree.js");
const builderRegistry = require("./build-plugins.js");
const targetModule = require("./target.js");

const DEPLOY_TYPES = {
    // Uses the config's "build" deployment.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" deployment.
    TYPE_DEPLOY: 'deploy'
};

function deployDeployStep(tree,options,targets) {
    // TODO
}

function deployBuildStep(tree,options) {
    var plugins = [];
    var targets = [];
    var outputTargets = [];

    return tree.getConfigParameter("builders").then((builders) => {
        // Load build plugins required by this deployment.
        for (var i = 0;i < builders.length;++i) {
            plugins.push( builderRegistry.load(builders[i].plugin) );
        }

        return tree.getConfigParameter("includes");
    }).then((includes) => {
        // Load set of initial targets from tree. Only include the blobs that
        // match an include object's pattern.

        return tree.walk((path,name,input) => {
            var candidate = pathModule.join(path,name);

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
                    targets.push( new targetModule.Target(path,name,input,info) );
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

        while (targets.length > 0) {
            var nextTarget = targets.pop();

            for (var i = 0;i < plugins.length;++i) {
                plugins[i].exec(nextTarget);
            }
        }

        return deployDeployStep(tree,options,outputTargets);
    });
}

function deployCommon(tree,options) {
    return new Promise((resolve,reject) => {
        options.buildPath = tree.getPath();

        // Obtain the deploy path. For TYPE_BUILD deployments, this is always
        // the same as the build path. For TYPE_DEPLOY deployments, this is
        // obtained from the configuration.

        if (options.type == DEPLOY_TYPES.TYPE_BUILD) {
            options.deployPath = options.buildPath;
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
}

// Initiates a deployment using the specified git-repository. The "options"
// object must contains a "type" property corresponding to one of the
// DEPLOY_TYPES.
function deployRepository(repo,options) {
    return treeLoader.createRepoTree(repo).then((tree) => {
        return deployCommon(tree,options);
    });
}

// Initiates a deployment using the files/directories from the local
// filesystem. The "options" object must contains a "type" property
// corresponding to one of the DEPLOY_TYPES.
function deployLocal(path,options) {
    return treeLoader.createPathTree(path).then((tree) => {
        return deployCommon(tree,options);
    });
}

module.exports = {
    deployRepository: deployRepository,
    deployLocal: deployLocal,

    types: DEPLOY_TYPES
};

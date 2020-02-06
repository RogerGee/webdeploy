/**
 * commands.js
 *
 * @module commands
 */

const assert = require("assert");
const pathModule = require("path").posix;
const git = require("nodegit");

const depends = require("./depends");
const logger = require("./logger");
const { createPathTree, createRepoTree } = require("./tree");
const { DelayedTarget } = require("./target");
const { Builder } = require("./builder");
const { Deployer } = require("./deployer");
const { PluginAuditor } = require("./audit");
const { WebdeployError } = require("./error");
const { prepareConfigPath } = require("./utils");

/**
 * Enumerates the configuation types supported by webdeploy.
 */
const CONFIG_TYPES = {
    // Uses the config's "build" configuration.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" configuration.
    TYPE_DEPLOY: 'deploy'
}

function deployBeforeChainCallback(currentPlugin,chainedPlugin) {
    logger.log("Chain deploy _" + currentPlugin.id + "_ -> _" + chainedPlugin.id + "_");
    logger.pushIndent();
}

function deployAfterChainCallback() {
    logger.popIndent();
}

function printNewTargetsCallback(target,plugin,newTargets) {
    if (newTargets.length > 0) {
        logger.pushIndent(target.level);
        var prefix = "exec _" + target.targetName + "_"
            + " -> *" + plugin.id + "* -> ";

        newTargetNames = newTargets.map((x) => { return x.targetName });
        logger.log(prefix + "_" + newTargetNames[0] + "_");
        for (var j = 1;j < newTargetNames.length;++j) {
            logger.log(" ".repeat(prefix.length - 7) + "-> _"
                       + newTargetNames[j] + "_");
        }
        logger.popIndent(target.level);
    }
}

function deployDeployStep(deployer,builder,options) {
    logger.log("Deploying targets: _" + deployer.deployConfig.id + "_");

    if (builder.outputTargets.length == 0) {
        if (options.ignored) {
            logger.pushIndent();
            if (options.type == CONFIG_TYPES.TYPE_BUILD) {
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

    // Execute the deployer.

    logger.pushIndent();
    return deployer.execute(builder).then(() => {
        logger.popIndent();
        return true;
    })
}

function deployBuildStep(tree,options) {
    var builder;
    var deployer;
    var auditor = new PluginAuditor();
    var targetBasePath = "";

    return tree.getConfigParameter("info").then((configInfo) => {
        logger.log("Loaded target tree config from _" + configInfo.file + "_");

        // Load base path from config. This config parameter is optional.

        return tree.getConfigParameter("basePath").then((theBasePath) => {
            targetBasePath = theBasePath;
        }, (e) => {})

    }).then(() => {
        return tree.getConfigParameter("includes");

    }).then((includes) => {
        // Create builder required for the run. Finalize the builder so that all
        // required plugins will be sent to the auditor.

        const builderOptions = {
            type: options.type,
            dev: options.dev,
            graph: options.graph,
            callbacks: {
                newTarget: printNewTargetsCallback
            }
        }

        builder = new Builder(tree,builderOptions);
        builder.pushIncludes(includes);
        builder.finalize(auditor);

        // Create deployer required for the run. Finalize the deployer so that all
        // required plugins will be sent to the auditor

        const deployerOptions = {
            deployConfig: options.deployConfig,
            deployPath: options.deployPath,
            callbacks: {
                beforeChain: deployBeforeChainCallback,
                afterChain: deployAfterChainCallback
            },
            tree
        }

        deployer = new Deployer(deployerOptions);
        deployer.finalize(auditor);

        // Audit all plugins before any build process has been started. This
        // will ensure all plugins are loadable or that we error out if a plugin
        // is not found.

        auditor.attachLogger(logger);

        return new Promise((resolve,reject) => {
            auditor.audit(function(error) {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            })
        })

    }).then(() => {
        // Display message denoting number of build plugins loaded.

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
            var delayedTarget = new DelayedTarget(relativePath,name,{
                createStreamFn: createInputStream
            });

            // If a potential target does not have a build product (i.e. is a
            // trivial product), then check to see if it is modified and should
            // be included or not.

            if (!options.force && options.graph && !options.graph.hasProductForSource(ref)) {
                var realRef = pathModule.join(targetBasePath,ref);
                targetPromises.push(tree.isBlobModified(realRef).then((result) => {
                    if (result) {
                        var newTarget = builder.pushInitialTargetDelayed(delayedTarget);
                        if (newTarget) {
                            logger.log("add _" + newTarget.getSourceTargetPath() + "_");
                        }
                    }
                    else {
                        options.ignored = true;
                    }
                }))
            }
            else {
                var newTarget = builder.pushInitialTargetDelayed(delayedTarget);
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
        })

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
        return deployDeployStep(deployer,builder,options);
    })
}

function deployStartStep(tree,options) {
    assert(options.type == CONFIG_TYPES.TYPE_BUILD
           || options.type == CONFIG_TYPES.TYPE_DEPLOY);

    var storeKey;

    // Obtain the deploy plugin name.

    return tree.getConfigParameter(options.type).then((deployConfig) => {
        if (typeof deployConfig !== "object") {
            throw new WebdeployError("Config parameter '" + options.type + "' must be a plugin object");
        }
        if (!deployConfig.id) {
            throw new WebdeployError("Config parameter '" + options.type + "' must have plugin id");
        }

        options.deployConfig = deployConfig;

        // Load up any extra deploy plugin options from the git-config.

        return tree.getConfigSection(deployConfig.id);

    }).then((sectionConfig) => {
        // Augment existing plugin object with discovered config section.
        var keys = Object.keys(sectionConfig);
        for (var i = 0;i < keys.length;++i) {
            asset(keys[i] != "id");
            options.deployConfig[keys[i]] = sectionConfig[keys[i]];
        }

        // Set build path. RepoTrees will return an empty string.

        options.buildPath = tree.getPath();
        if (!options.buildPath) {
            options.buildPath = "";
        }

        // For a TYPE_DEPLOY deployment, we need a deploy path. This may have
        // been specified by the user in the options object, OR we lookup the
        // default deploy path stored in the tree configuration.

        if (options.type == CONFIG_TYPES.TYPE_DEPLOY) {
            if (!options.deployPath) {
                return tree.getConfigParameter("deployPath");
            }
            else {
                return Promise.resolve(options.deployPath);
            }
        }

        // Otherwise for TYPE_BUILD deployments the deploy path is the same as
        // the build path (since local builds deploy to the same location).

        return Promise.resolve(options.buildPath);

    }).then((deployPath) => {
        // Set deploy path; also set the deploy path as the storage key for the
        // tree. This is used by RepoTree's for config lookup purposes.

        storeKey = prepareConfigPath(deployPath);

        options.deployPath = deployPath;
        tree.addOption('storeKey',storeKey);

        // Load up dependency graph.

        return depends.loadFromTree(tree,storeKey);

    }).then((graph) => {
        options.graph = graph;

        if (options.force) {
            options.graph.reset();
        }

        // Execute the build pipeline. This will chain to the deploy pipeline
        // after the build.

        return deployBuildStep(tree,options);

    }).then(() => {
        // Save the dependency graph if available.
        if (options.graph) {
            return depends.saveToTree(tree,options.graph,storeKey);
        }

    }).then(() => {
        if (tree.name == 'RepoTree') {
            return tree.saveDeployCommit(options.deployPath);
        }

    })
}

/**
 * Initiates a deployment using the specified git repository.
 *
 * @param {string} repo
 *  The path to the git repository to load.
 * @param {object} options
 *  The list of options to pass to the commands.
 * @param {string} options.type
 *  One of the commands.types enumerators.
 *
 * @return {Promise}
 *  Returns a Promise that resolves when the operation completes or rejects when
 *  the operation fails.
 */
function deployRepository(repo,options) {
    var treeOptions = {
        deployBranch: options.deployBranch,
        deployTag: options.deployTag
    }

    return createRepoTree(repo,treeOptions).then((tree) => {
        return deployStartStep(tree,options);
    })
}

/**
 * Initiates a deployment using the specified tree from the local filesystem.
 *
 * @param {string} path
 *  The path to the tree to deploy.
 * @param {object} options
 *  The list of options to pass to the commands.
 * @param {string} options.type
 *  One of the commands.types enumerators.
 *
 * @return {Promise}
 *  Returns a Promise that resolves when the operation completes or rejects when
 *  the operation fails.
 */
function deployLocal(path,options) {
    return createPathTree(path).then((tree) => {
        return deployStartStep(tree,options);
    })
}

/**
 * Callback for 'deployDecide' function.
 * @callback module:commands~decideCallback
 * @param {string} type
 *  One of either "repo" or "local".
 */

/**
 * Initiates a deployment, deciding whether or not to use a local directory or a
 * git repository. Git repositories have precedence.
 *
 * @param {string} path
 *  The path to the a git repository or local path.
 * @param {object} options
 *  The list of options to pass to the commands.
 * @param {string} options.type
 *  One of the CONFIG_TYPES enumerators.
 * @param {module:commands~decideCallback} decideCallback
 *  A callback that is passed the decision that was made.
 *
 * @return {Promise}
 *  Returns a Promise that resolves when the operation completes or rejects when
 *  the operation fails.
 */
function deployDecide(path,options,decideCallback) {
    var prevPath = pathModule.resolve(pathModule.join(path,".."));

    return git.Repository.discover(path,0,prevPath).then((repoPath) => {
        decideCallback("repo");
        return deployRepository(repoPath,options);

    }, (err) => {
        decideCallback("local");
        return deployLocal(path,options);
    })
}

module.exports = {
    deployRepository,
    deployLocal,
    deployDecide,

    CONFIG_TYPES
}

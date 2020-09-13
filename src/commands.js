/**
 * commands.js
 *
 * @module commands
 */

const assert = require("assert");
const path = require("path").posix;
const fs = require("fs");
const git = require("nodegit");

const { DependencyGraph, ConstDependencyGraph } = require("./depends");
const logger = require("./logger");
const { RepoTree } = require("./tree/repo-tree");
const { PathTree } = require("./tree/path-tree");
const { DelayedTarget } = require("./target");
const { Builder } = require("./builder");
const { Deployer } = require("./deployer");
const { PluginAuditor } = require("./audit");
const { WebdeployError } = require("./error");

/**
 * Enumerates the configuation types supported by webdeploy.
 */
const CONFIG_TYPES = {
    // Uses the config's "build" configuration.
    TYPE_BUILD: 'build',

    // Uses the config's "deploy" configuration.
    TYPE_DEPLOY: 'deploy'
}

const DEPENDS_CONFIG_KEY = "cache.depends";

function deployBeforeChainCallback(currentPlugin,chainedPlugin) {
    if (!currentPlugin) {
        logger.log("Predeploy -> *" + chainedPlugin.id + "*");
    }
    else {
        logger.log("Chain deploy *" + currentPlugin.id + "* -> *" + chainedPlugin.id + "*");
    }
    logger.pushIndent();
}

function deployAfterChainCallback() {
    logger.popIndent();
}

function printNewTargetsCallback(target,plugin,newTargets) {
    if (newTargets.length > 0) {
        var prefix = "Exec _" + target.targetName + "_"
            + " -> *" + plugin.id + "* -> ";

        newTargetNames = newTargets.map((x) => { return x.targetName });
        logger.log(prefix + "_" + newTargetNames[0] + "_");
        for (var j = 1;j < newTargetNames.length;++j) {
            logger.log(" ".repeat(prefix.length - 7) + "-> _"
                       + newTargetNames[j] + "_");
        }
    }
}

function deployDeployStep(deployer,builder,options) {
    logger.log("Deploying targets: *" + deployer.deployConfig.id + "*");

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
    });
}

function deployBuildStep(tree,options) {
    var builder;
    var deployer;
    var auditor = new PluginAuditor();

    return tree.getTargetConfig("info").then((configInfo) => {
        logger.log("Loaded target tree config from _" + configInfo.file + "_");

        // Load base path from config. This config parameter is optional.

        return tree.getTargetConfig("basePath",true);

    }).then((basePath) => {
        tree.addOption('basePath',basePath);

        // Load 'includes' section from target config.

        return tree.getTargetConfig("includes");

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

        // Create deployer required for the run. Then finalize the deployer so
        // that all required plugins will be sent to the auditor

        const deployerOptions = {
            deployConfig: options.deployConfig,
            deployPath: tree.getDeployConfig('deployPath'),
            callbacks: {
                beforeChain: deployBeforeChainCallback,
                afterChain: deployAfterChainCallback
            },
            tree,
            prevGraph: options.prevGraph
        };

        deployer = new Deployer(deployerOptions);
        deployer.finalize(auditor);

        // Audit all plugins before any build process has been started. This
        // will ensure all plugins are loadable or that we error out if a plugin
        // is not found.

        auditor.attachTree(tree);
        auditor.attachLogger(logger);

        return auditor.audit();

    }).then(() => {
        // Calculate the set of ignored targets given a dependency graph.
        // Otherwise return an empty set.

        if (options.graph && options.graph.isResolved()) {
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

        var walkcb = ({ targetPath, targetName },createInputStream) => {
            var ref = path.join(targetPath,targetName);

            // Ignore potential targets that were determined to not belong in
            // the build since they map to build products that are already
            // up-to-date.

            if (ignoreSet.has(ref)) {
                options.ignored = true;
                return;
            }

            // Create a delayed target object and attempt to add it to the
            // builder.
            var delayedTarget = new DelayedTarget(
                targetPath,
                targetName,
                {
                    createStreamFn: createInputStream
                }
            );

            // If a potential target does not have a build product (i.e. is a
            // trivial product), then check to see if it is modified and should
            // be included or not.

            if (!options.force
                && options.graph.isResolved()
                && !options.graph.hasProductForSource(ref))
            {
                targetPromises.push(
                    tree.isBlobModified(ref).then((result) => {
                        if (result) {
                            var newTarget = builder.pushInitialTargetDelayed(delayedTarget);
                            if (newTarget) {
                                logger.log("Add _" + newTarget.getSourceTargetPath() + "_");
                            }
                        }
                        else {
                            options.ignored = true;
                        }
                    })
                );
            }
            else {
                var newTarget = builder.pushInitialTargetDelayed(delayedTarget);
                if (newTarget) {
                    logger.log("Add _" + newTarget.getSourceTargetPath() + "_");
                }
            }
        };

        var walkopts = {
            filter: function(targetPath) {
                // Ignore any hidden paths.
                if (targetPath[0] == ".") {
                    return false;
                }

                return true;
            }
        };

        return tree.walk(walkcb,walkopts).then(() => {
            return Promise.all(targetPromises);
        });

    }).then(() => {
        if (builder.targets.length == 0) {
            logger.log("*No Targets*");
        }

        // Send each target through each plugin.

        logger.popIndent();
        logger.log("Building targets:");
        logger.pushIndent();

        if (builder.targets.length == 0) {
            logger.log("*No Targets*");
        }

        return builder.execute();

    }).then(() => {
        logger.popIndent();

        return deployDeployStep(deployer,builder,options);
    });
}

function deployStartStep(tree,options) {
    assert(options.type == CONFIG_TYPES.TYPE_BUILD
           || options.type == CONFIG_TYPES.TYPE_DEPLOY);

    var storeKey;

    // Load deploy plugin config from target tree config.

    return tree.getTargetConfig(options.type).then((deployConfig) => {
        if (typeof deployConfig !== "object") {
            throw new WebdeployError("Config parameter '" + options.type + "' must be a plugin object");
        }
        if (!deployConfig.id) {
            throw new WebdeployError("Config parameter '" + options.type + "' must have plugin id");
        }

        options.deployConfig = deployConfig;

        // Load up dependency graph from tree deployment.

        return tree.getStorageConfig(DEPENDS_CONFIG_KEY);

    }).then((repr) => {
        options.graph = new DependencyGraph(repr);
        options.prevGraph = new ConstDependencyGraph(repr);

        // Reset dependency graph if set in options.

        if (options.force) {
            options.graph.reset();
        }

        // Execute the build pipeline. This will chain to the deploy pipeline
        // after the build.

        return deployBuildStep(tree,options);

    }).then(() => {
        // Save dependency graph.

        var repr;
        options.graph.resolve();
        repr = options.graph.getStorageRepr();

        return tree.writeStorageConfig(DEPENDS_CONFIG_KEY,repr);

    }).then(() => {
        // Perform tree finalization.

        return tree.finalize();
    });
}

/**
 * Creates a new RepoTree for the specified repository.
 *
 * @param {string} repoPath
 *  The path where the repository lives.
 * @param {object} options
 *  Extra options for the RepoTree.
 *
 * @return {Promise<module:tree/repo-tree~RepoTree>}
 */
function createRepoTree(repoPath,options) {
    return git.Repository.discover(repoPath,0,"").then((discoveredPath) => {
        return git.Repository.open(discoveredPath);

    }).then((repository) => {
        return new RepoTree(repository,options);
    });
}

/**
 * Creates a new PathTree for the specified path in the filesystem.
 *
 * @param {string} treePath
 *  The path to load.
 * @param {object} options
 *  Extra options for the PathTree.
 *
 * @return {Promise<module:tree/path-tree~PathTree>}
 */
function createPathTree(treePath,options) {
    return new Promise((resolve,reject) => {
        if (options.noexist) {
            resolve(new PathTree(treePath,options));
            return;
        }

        fs.stat(treePath,(err,stats) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(new PathTree(treePath,options));
        });
    });
}

/**
 * Creates a tree instance. The type of tree is determined based on the path. If
 * the points to a git repository, then a RepoTree instance is loaded; otherwise
 * a PathTree instance is loaded.
 *
 * @param {string} repoOrTreePath
 *  The path to the a git repository or local path.
 * @param {object} options
 *  The list of options to pass to the commands.
 *
 * @return {Promise<module:tree~Tree>}
 */
function createTreeDecide(repoOrTreePath,options) {
    var prevPath = path.resolve(path.join(repoOrTreePath,".."));

    // If the indicated path refers to a discoverable git repository, then we
    // create a RepoTree. Otherwise we create a PathTree. NOTE: This will prefer
    // RepoTree for a bare git repository and PathTree for a working tree.

    return git.Repository.discover(repoOrTreePath,0,prevPath).then((repoPath) => {
        return createRepoTree(repoOrTreePath,options);

    }, (err) => {
        return createPathTree(repoOrTreePath,options);
    });
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
    // We always use a root (i.e. empty) build path when deploying projects via
    // RepoTree.
    options.buildPath = "";

    // Isolate options that we provide to the repo tree.
    const treeOptions = {
        deployPath: options.deployPath,
        deployBranch: options.deployBranch,
        deployTag: options.deployTag
    };

    return createRepoTree(repo,treeOptions).then((tree) => {
        return deployStartStep(tree,options);
    });
}

/**
 * Initiates a deployment using the specified tree from the local filesystem.
 *
 * @param {string} treePath
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
function deployLocal(treePath,options) {
    // Set build path for local deployment. For PathTree instances, this is
    // always the same as the path to the tree.
    options.buildPath = treePath;

    const treeOptions = {
        deployPath: treePath
    };

    return createPathTree(treePath,treeOptions).then((tree) => {
        return deployStartStep(tree,options);
    });
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
 * @param {string} repoOrTreePath
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
function deployDecide(repoOrTreePath,options,decideCallback) {
    var prevPath = path.resolve(path.join(repoOrTreePath,".."));

    // NOTE: This prefers git repositories over path trees. This means that we
    // will choose a git repository (.git subfolder) over the working tree.

    return git.Repository.discover(repoOrTreePath,0,prevPath).then((repoPath) => {
        decideCallback("repo");
        return deployRepository(repoPath,options);

    }, (err) => {
        decideCallback("local");
        return deployLocal(repoOrTreePath,options);
    });
}

function configdef(repoOrTreePath,key,value) {
    var options = {
        createDeployment: false
    };

    return createTreeDecide(repoOrTreePath,options).then((tree) => {
        var record = tree.getTreeRecord();
        if (value) {
            if (!tree.writeTreeRecord(key,value)) {
                throw new WebdeployError("Key '"+key+"' is not a valid default setting");
            }
        }
        else {
            var treeRecord = tree.getTreeRecord();
            if (key in treeRecord) {
                if (treeRecord[key]) {
                    logger.log(treeRecord[key]);
                }
            }
            else {
                throw new WebdeployError("Key '"+key+"' is not a valid default setting");
            }
        }

        return tree.finalize();
    });
}

function config(repoOrTreePath,deployPath,key,value) {
    var options = {
        createDeployment: true,
        deployPath
    };

    return createTreeDecide(repoOrTreePath,options).then((tree) => {
        var record = tree.getTreeRecord();

        if (value) {
            if (!tree.writeDeployConfig(key,value)) {
                throw new WebdeployError("Key '"+key+"' is not a valid deployment setting");
            }
        }
        else {
            var display = tree.getDeployConfig(key);
            if (display) {
                logger.log(display);
            }
        }

        return tree.finalize();
    });
}

function info(repoOrTreePath,deployPath) {
    var options = {
        createTree: false,
        createDeployment: false,
        deployPath
    };

    return createTreeDecide(repoOrTreePath,options).then((tree) => {
        if (!tree.exists()) {
            throw new WebdeployError("Path "+repoOrTreePath+" is not a webdeploy project tree");
        }

        logger.log("*"+repoOrTreePath+"*");
        logger.pushIndent();

        var treeRecord = tree.getTreeRecord();

        logger.log("*Defaults*:");
        logger.pushIndent();
        logger.log("Target Tree: " + logger.filter(treeRecord.targetTree,'(root)'));
        logger.log("Deploy Path: " + logger.filter(treeRecord.deployPath));
        logger.log("Deploy Branch: " + logger.filter(treeRecord.deployBranch));
        logger.popIndent();

        logger.log("*Deployment*:");
        logger.pushIndent();
        if (tree.hasDeployment()) {
            logger.log("Deploy Path: " + logger.filter(tree.getDeployConfig('deployPath')));
            logger.log("Deploy Branch: " + logger.filter(tree.getDeployConfig('deployBranch')));
            logger.log("Last Deploy Revision: " + logger.filter(tree.getDeployConfig('lastRevision')));
        }
        else {
            logger.log("No such deployment at " + logger.filter(tree.getDeployConfig('deployPath')));
        }
        logger.popIndent();

        logger.popIndent();
    });
}

function purge(repoOrTreePath,deployPath,purgeAll) {
    var options = {
        createTree: false,
        createDeployment: false,
        deployPath,
        noexist: true
    };

    return createTreeDecide(repoOrTreePath,options).then((tree) => {
        if (!tree.exists()) {
            throw new WebdeployError("Path "+repoOrTreePath+" is not a webdeploy project tree");
        }

        if (!purgeAll && !tree.hasDeployment()) {
            logger.log(
                "No such deployment at " + logger.filter(tree.getDeployConfig('deployPath'))
                    + " for " + repoOrTreePath);
            return;
        }

        tree.purgeDeploy(purgeAll);
    });
}

module.exports = {
    deployRepository,
    deployLocal,
    deployDecide,
    configdef,
    config,
    info,
    purge,

    CONFIG_TYPES
}

/**
 * commands.js
 *
 * @module commands
 */

const commander = require("commander");
const path = require("path").posix;
const fs = require("fs");
const git = require("nodegit");
const logger = require("./logger");
const { Kernel } = require("./kernel");
const { RepoTree } = require("./tree/repo-tree");
const { PathTree } = require("./tree/path-tree");
const { WebdeployError } = require("./error");
const { version: VERSION } = require("../package.json");

function webdeploy_fail(err) {
    logger.resetIndent();
    logger.error("\n*[FAIL]* " + String(err));
    if (err.stack) {
        console.error("");
        console.error(err.stack);
    }
}

function resolveSourcePath(sourcePath) {
    if (sourcePath) {
        return path.resolve(sourcePath);
    }
    return path.resolve(".");
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
        const kernel = new Kernel(tree,options);
        return kernel.execute();
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
        const kernel = new Kernel(tree,options);
        return kernel.execute();
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
 *  One of the Kernel.TYPES enumerators.
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

commander.version(VERSION,"-v, --version");

commander.command("configdef <key> [value]")
    .description("gets/sets defaults for a webdeploy project tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((key,value,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        configdef(localPath,key,value).catch(webdeploy_fail);
    });

commander.command("config <deploy-path> <key> [value]")
    .description("gets/sets deployment config for a webdeploy project tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((deployPath,key,value,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        if (deployPath) {
            deployPath = path.resolve(deployPath);
        }
        config(localPath,deployPath,key,value).catch(webdeploy_fail);
    });

commander.command("info [deploy-path]")
    .description("displays info about a webdeploy tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((deployPath,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        if (deployPath) {
            deployPath = path.resolve(deployPath);
        }
        info(localPath,deployPath).catch(webdeploy_fail);
    });

commander.command("purge [deploy-path]")
    .description("purges deployment info for a webdeploy project tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .option("--all","Indicates that the entire project tree is to be purged")
    .action((deployPath,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        if (deployPath) {
            deployPath = path.resolve(deployPath);
        }
        purge(localPath,deployPath,!!cmd.all).catch(webdeploy_fail);
    });

commander.command("deploy [path]")
    .description("runs the deploy task on a webdeploy project")
    .option("-f, --force","Force full deploy without consulting dependencies")
    .option("-p, --deploy-path [path]","Denotes the deploy path destination on disk")
    .option("-b, --deploy-branch [branch]","Denotes repository branch to deploy")
    .option("-t, --deploy-tag [tag]","Denotes the repository tag to deploy")
    .action((sourcePath,cmd) => {
        if (cmd.deployBranch && cmd.deployTag) {
            throw new WebdeployError("Invalid arguments: specify one of deploy-branch and deploy-tag");
        }

        var options = {
            type: Kernel.TYPES.DEPLOY,
            force: cmd.force ? true : false,
            deployBranch: cmd.deployBranch,
            deployTag: cmd.deployTag,
            deployPath: cmd.deployPath
        };

        var localPath = resolveSourcePath(sourcePath);

        deployDecide(localPath, options, (type) => {
            logger.log("*[DEPLOY]* *" + type + "*: exec " + localPath);
            logger.pushIndent();

        }, webdeploy_fail).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");

        }).catch(webdeploy_fail)
    });

commander.command("build [path]")
    .description("runs the build task on a webdeploy project")
    .option("-p, --prod","Perform production build")
    .option("-d, --dev","Perform development build (default)")
    .option("-f, --force","Force full build without consulting dependencies")
    .action((sourcePath,cmd) => {
        if (cmd.prod && cmd.dev) {
            logger.error("webdeploy: build: Please specify one of *prod* or *dev*.".bold);
            return;
        }

        var options = {
            dev: cmd.dev || !cmd.prod,
            type: Kernel.TYPES.BUILD,
            force: cmd.force ? true : false
        };

        var localPath = resolveSourcePath(sourcePath);

        logger.log("*[BUILD]* *local*: exec " + localPath);
        logger.pushIndent();

        deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");

        }, webdeploy_fail).catch(webdeploy_fail);
    });

module.exports = {
    commander,
    webdeploy_fail
};

// tree.js - webdeploy

const fs = require("fs");
const path = require("path");
const git = require("nodegit");
const configuration = require("./config.js");

function repoTreeGetConfig($this,param,useLocalConfig) {
    // RepoTrees look up configuration parameters from the combined git and
    // local file configuration pools.

    return new Promise((resolve,reject) => {
        if ($this.config && $this.config[param]) {
            resolve($this.config[param]);
        }
        else if (useLocalConfig && !$this.fileConfig) {
            configuration.loadFromTree($this).then((config) => {
                $this.fileConfig = config;
                $this.getConfigParameter(param).then(resolve,reject);
            }, reject);
        }
        else if (useLocalConfig && $this.fileConfig[param]) {
            resolve($this.fileConfig[param]);
        }
        else if (!$this.gitConfig) {
            $this.repo.config().then((config) => {
                $this.gitConfig = config;
                $this.getConfigParameter(param).then(resolve,reject);
            }, reject);
        }
        else {
            var gitConfigParam = "webdeploy." + param;

            $this.gitConfig.getStringBuf(gitConfigParam).name((buf) => {
                $this.config[param] = buf.toString('utf8');
                resolve($this.config[param]);
            }, reject);
        }
    });
}

function repoTreeGetDeployCommit($this) {
    return new Promise((resolve,reject) => {
        if ($this.deployCommit) {
            return $this.deployCommit;
        }

        repoTreeGetConfig($this,"deploy-branch",false).then((deployBranch) => {
            return $this.repo.getReference(deployBranch);
        }).then((reference) => {
            return git.Commit.lookup($this.repo, reference.target());
        }).then((commit) => {
            $this.deployCommit = commit;
            resolve($this.deployCommit);
        }).catch(reject);
    });
}

function repoTreeGetTree($this,treePath) {
    return new Promise((resolve,reject) => {
        repoTreeGetDeployCommit($this).then((commit) => {
            return commit.getTree();
        }).then((tree) => {
            if (treePath == "") {
                resolve(tree);
            }
            else {
                tree.getEntry(treePath).then((entry) => {
                    if (!entry.isTree()) {
                        return Promise.reject(new Error("Path does not refer to tree"));
                    }

                    entry.getTree().then(resolve);
                });
            }
        }).catch(reject);
    });
}

function RepoTree(repo) {
    this.repo = repo;
    this.config = {}; // cache git-config entries here
}

// Gets a promise to string.
RepoTree.prototype.getConfigParameter = (param) => {
    return repoTreeGetConfig(this,param,true);
};

// Gets a Promise to Buffer. The blobPath is relative to the target tree.
RepoTree.prototype.loadBlob = (blobPath) => {
    var targetTree = repoTreeGetConfig(this,'target-tree',false);

    if (!targetTree || targetTree == "/") {
        targetTree = "";
    }

    return repoTreeGetTree(this,targetTree).then((tree) => {
        return tree.getEntry(blobPath);
    }).then((entry) => {
        if (!entry.isBlob()) {
            return Promise.reject(new Error("Path does not refer to a blob"));
        }

        return entry.getBlob();
    }).then((blob) => {
        return blob.content();
    });
};

function PathTree(basePath) {
    this.basePath = basePath;
}

PathTree.prototype.getConfigParameter = (param) => {
    var $this = this;

    // PathTrees lookup configuration parameters from the local file
    // configuration only.

    return new Promise((resolve,reject) => {
        if (!$this.fileConfig) {
            configuration.loadFromTree($this).then((config) => {
                $this.fileConfig = config;
                $this.getConfigParameter(param).then(resolve,reject);
            }, reject);
        }
        else if ($this.fileConfig[param]) {
            resolve($this.fileConfig[param]);
        }
        else {
            reject(new Error("No such configuration parameter"));
        }
    });
};

PathTree.prototype.loadBlob = (blobPath) => {

};

function createGitTree(repoPath) {
    return new Promise((resolve,reject) => {
        git.Repository.discover(repoPath,false,null).then((path) => {
            git.Repository.init(path,true).then((repository) => {
                resolve(new RepoTree(repository));
            }, reject);
        });
    });
}

function createPathTree(path) {
    return new Promise((resolve,reject) => {
        fs.stat(path,(err,stats) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(new PathTree(path));
        }, reject);
    });
}

module.exports = {
    loadFromGitRepository: createGitTree,
    loadFromPath: createPathTree
};

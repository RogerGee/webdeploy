// tree.js - webdeploy

const fs = require("fs");
const path = require("path");
const git = require("nodegit");
const stream = require("stream");
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
                repoTreeGetConfig($this,param,useLocalConfig).then(resolve,reject);
            }, reject);
        }
        else if (useLocalConfig && $this.fileConfig[param]) {
            resolve($this.fileConfig[param]);
        }
        else if (!$this.gitConfig) {
            $this.repo.config().then((config) => {
                $this.gitConfig = config;
                repoTreeGetConfig($this,param,useLocalConfig).then(resolve,reject);
            }, reject);
        }
        else {
            var gitConfigParam = "webdeploy." + param;

            $this.gitConfig.getStringBuf(gitConfigParam).then((buf) => {
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

function repoTreeGetBlob($this,blobPath,targetTree) {
    if (!targetTree || targetTree == "/") {
        targetTree = "";
    }

    return repoTreeGetTree($this,targetTree).then((tree) => {
        return tree.getEntry(blobPath);
    }).then((entry) => {
        if (!entry.isBlob()) {
            return Promise.reject(new Error("Path does not refer to a blob"));
        }

        return entry.getBlob();
    }).then((blob) => {
        // Fake a stream for the content buffer. It doesn't seem nodegit
        // provides the ODB read stream yet (and the default ODB backends don't
        // provide streaming capabilities anyways).

        var bufferStream = new stream.PassThrough();
        bufferStream.end(blob.content());

        return bufferStream;
    });
}

function RepoTree(repo) {
    this.repo = repo;
    this.config = {}; // cache git-config entries here
}

// Gets a Promise -> String. The parameter name is qualified with "webdeploy"
// when searching through git-config.
RepoTree.prototype.getConfigParameter = function(param) {
    return repoTreeGetConfig(this,param,true);
};

// Gets a Promise -> Stream. The blobPath is relative to the configured target
// tree.
RepoTree.prototype.getBlob = function(blobPath) {
    return repoTreeGetConfig(this,'target-tree',false)
        .then((targetTree) => { repoTreeGetBlob(this,blobPath,targetTree); },
              (err) => { return repoTreeGetBlob(this,blobPath); });
};

function PathTree(basePath) {
    this.basePath = basePath;
}

PathTree.prototype.getConfigParameter = function(param) {
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

// Gets a Promise -> Stream.
PathTree.prototype.getBlob = function(blobPath) {
    // Qualify the blobPath with the tree's base path.
    var blobPathQualified = path.join(this.basePath,blobPath);

    return new Promise((resolve,reject) => {
        try {
            resolve(fs.createReadStream(blobPathQualified));
        } catch (err) {
            reject(err);
        }
    });
};

function createGitTree(repoPath) {
    return git.Repository.discover(repoPath,0,"").then((path) => {
        return git.Repository.open(path);
    }).then((repository) => {
        return new RepoTree(repository);
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
    createGitTree: createGitTree,
    createPathTree: createPathTree
};

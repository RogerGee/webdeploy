// tree.js - webdeploy

const fs = require("fs");
const path = require("path");
const git = require("nodegit");
const stream = require("stream");
const configuration = require("./config.js");

function normalizeTargetTree(targetTree) {
    // The path "/" is the root directory of the repo's target tree. This means
    // the prefix should be empty when doing a lookup.

    if (!targetTree || targetTree == "/") {
        return "";
    }

    return targetTree;
}

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
            }, (err) => {
                reject(err + ": " + config);
            });
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

function makeBlobStream(blob) {
    // Fake a stream for the content buffer. It doesn't seem nodegit provides
    // the ODB read stream yet (and the default ODB backends don't provide
    // streaming capabilities anyways).

    var bufferStream = new stream.PassThrough();
    bufferStream.end(blob.content());

    return bufferStream;
}

function repoTreeGetBlob($this,blobPath,targetTree) {
    targetTree = normalizeTargetTree(targetTree);

    return repoTreeGetTree($this,targetTree).then((tree) => {
        return tree.getEntry(blobPath);
    }).then((entry) => {
        if (!entry.isBlob()) {
            return Promise.reject(new Error("Path does not refer to a blob"));
        }

        return entry.getBlob();
    }).then(makeBlobStream);
}

function repoTreeWalkImpl($this,prefix,tree,callback,filter) {
    return new Promise((resolve,reject) => {
        let entries = tree.entries();
        let outstanding = 1;

        function attemptResolution() {
            if (--outstanding <= 0) {
                resolve();
            }
        }

        for (let i = 0;i < entries.length;++i) {
            let ent = entries[i];

            if (ent.isBlob()) {
                outstanding += 1;
                $this.repo.getBlob(ent.oid()).then((blob) => {
                    callback(prefix,ent.path(),makeBlobStream);
                    attemptResolution();
                }, reject);
            }
            else if (ent.isTree()) {
                let newPrefix = path.join(prefix,ent.name());
                if (!filter || filter(newPrefix)) {
                    outstanding += 1;
                    $this.repo.getTree(ent.oid()).then((nextTree) => {
                        return repoTreeWalkImpl($this,newPrefix,nextTree,callback,filter);
                    }, reject).then(attemptResolution);
                }
            }
        }

        attemptResolution();
    });
}

function repoTreeWalk($this,callback,filter,targetTree) {
    targetTree = normalizeTargetTree(targetTree);

    return repoTreeGetTree($this,targetTree).then((tree) => {
        return repoTreeWalkImpl($this,targetTree,tree,callback,filter);
    });
}

function RepoTree(repo) {
    this.repo = repo;
    this.config = {}; // cache git-config entries here
}

// Gets a String. Gets the path to the tree. Since this is a git-repository,
// this is always null.
RepoTree.prototype.getPath = function() {
    return null;
};

// Gets a Promise -> String. The function automatically qualifies the parameter
// name with "webdeploy" when searching through git-config.
RepoTree.prototype.getConfigParameter = function(param) {
    return repoTreeGetConfig(this,param,true);
};

// Gets a Promise -> Stream. The blobPath is relative to the configured target
// tree.
RepoTree.prototype.getBlob = function(blobPath) {
    return repoTreeGetConfig(this,'target-tree',false)
        .then((targetTree) => { return repoTreeGetBlob(this,blobPath,targetTree); },
              (err) => { return repoTreeGetBlob(this,blobPath); });
};

// Gets a Promise. Walks the tree and calls callback(path,name,stream) for each
// blob. If specified, filter(path) -> false heads off a particular path branch.
RepoTree.prototype.walk = function(callback,filter) {
    return repoTreeGetConfig(this,'target-tree',false)
        .then((targetTree) => { return repoTreeWalk(this,callback,filter,targetTree); },
              (err) => { return repoTreeWalk(this,callback,filter); });
};

function PathTree(basePath) {
    this.basePath = basePath;
}

// Gets a String. Gets the path to the tree.
PathTree.prototype.getPath = function() {
    return this.basePath;
};

// Gets a Promise -> String.
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
            reject(new Error("No such configuration parameter: '" + param + "'"));
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

// Gets a Promise. Walks the tree and calls callback(path,name,stream) for each
// blob. If specified, filter(path) -> false heads off a particular branch path.
PathTree.prototype.walk = function(callback,filter) {
    return new Promise((resolve,reject) => {
        let outstanding = 1;

        function attemptResolution() {
            if (--outstanding <= 0) {
                resolve();
            }
        }

        function walkRecursive(basePath) {
            return (err,files) => {
                for (let i = 0;i < files.length;++i) {
                    var filePath = path.join(basePath,files[i]);
                    var stat = fs.lstatSync(filePath);
                    if (stat.isFile()) {
                        callback(basePath,files[i],fs.createReadStream(filePath));
                    }
                    else if (stat.isDirectory()) {
                        if (!filter || filter(filePath)) {
                            outstanding += 1;
                            fs.readdir(filePath,walkRecursive(filePath));
                        }
                    }
                }

                attemptResolution();
            };
        }

        fs.readdir(this.basePath,walkRecursive(this.basePath));
    });
};

// Gets a Promise -> RepoTree.
function createRepoTree(repoPath) {
    return git.Repository.discover(repoPath,0,"").then((path) => {
        return git.Repository.open(path);
    }).then((repository) => {
        return new RepoTree(repository);
    });
}

// Gets a Promise -> PathTree.
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
    createRepoTree: createRepoTree,
    createPathTree: createPathTree
};

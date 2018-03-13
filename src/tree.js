// tree.js - webdeploy

const fs = require("fs");
const path = require("path").posix;
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

function repoTreeGetConfigObject($this) {
    if ($this.gitConfig) {
        return Promise.resolve($this.gitConfig);
    }

    return $this.repo.config().then((config) => {
        $this.gitConfig = config;

        return config;
    });
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
        else {
            repoTreeGetConfigObject($this).then((config) => {
                return config.getStringBuf("webdeploy." + param);
            }).then((buf) => {
                $this.config[param] = buf.toString('utf8');
                resolve($this.config[param]);
            }).catch(reject);
        }
    });
}

function repoTreeGetDeployCommit($this) {
    const COMMIT_ID = "HEAD";

    if (COMMIT_ID in $this.deployCommits) {
        return $this.deployCommits[COMMIT_ID];
    }

    return $this.deployCommits[COMMIT_ID] = repoTreeGetConfig($this,"deployBranch",false)
        .then((deployBranch) => {
            return $this.repo.getReference(deployBranch);
        }).then((reference) => {
            return git.Commit.lookup($this.repo, reference.target());
        });
}

function repoTreeGetPreviousCommit($this) {
    // NOTE: The promise resolves to null if the commit was not found. Rejection
    // occurs on any other, unanticipated error.

    const COMMIT_ID = "PREV";

    if (COMMIT_ID in $this.deployCommits) {
        return $this.deployCommits[COMMIT_ID];
    }

    return $this.deployCommits[COMMIT_ID] = repoTreeGetConfig($this,"cache.lastDeploy",false)
        .then((previousCommitOid) => {
            return $this.repo.getCommit(previousCommitOid);
        }, (err) => { return Promise.resolve(null); });
}

function repoTreeGetTree($this,treePath,commit) {
    function callback(commit) {
        return commit.getTree()
            .then((tree) => {
                if (treePath == "") {
                    return tree;
                }

                return tree.getEntry(treePath).then((entry) => {
                    if (!entry.isTree()) {
                        return Promise.reject(new Error("Path does not refer to tree"));
                    }

                    return entry.getTree();
                });
            });
    }

    if (!commit) {
        // Default to current deploy commit.
        return repoTreeGetDeployCommit($this).then(callback);
    }

    return callback(commit);
}

function repoTreeGetTargetTree($this,commit) {
    if (commit) {
        var commitId = commit.id().tostrS();
    }
    else {
        var commitId = 'target';
    }

    if ($this.targetTrees[commitId]) {
        return $this.targetTrees[commitId];
    }

    return $this.targetTrees[commitId] = repoTreeGetConfig($this,'targetTree',false)
        .then((targetTreePath) => {
            return repoTreeGetTree($this,normalizeTargetTree(targetTreePath),commit);
        },(err) => {
            return repoTreeGetTree($this,normalizeTargetTree(),commit);
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

function repoTreeGetBlob($this,blobPath,tree) {
    return tree.getEntry(blobPath)
        .then((entry) => {
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
                    callback(prefix,ent.path(),() => { return makeBlobStream(blob); });
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

function repoTreeWalk($this,callback,filter,tree) {
    return repoTreeWalkImpl($this,tree.path(),tree,callback,filter);
}

class RepoTree {
    constructor(repo) {
        this.name = 'RepoTree';
        this.repo = repo;
        this.config = {}; // cache git-config entries here

        // Cache Promises to certain, often-accessed resources.
        this.deployCommits = {};
        this.targetTrees = {};
    }

    // Gets a String. Gets the path to the tree. Since this is a git-repository,
    // this is always null.
    getPath() {
        return null;
    }

    // Gets a Promise -> String. The function automatically qualifies the
    // parameter name with "webdeploy" when searching through git-config.
    getConfigParameter(param) {
        return repoTreeGetConfig(this,param,true);
    }

    // Gets a Promise. The Promise resolves when the operation is finished.
    writeConfigParameter(param,value) {
        // Force param key under webdeploy section.
        param = "webdeploy." + param;

        if (typeof value == 'Number') {
            return repoTreeGetConfigObject(this).then((config) => {
                config.setInt64(param,value);
            });
        }

        return repoTreeGetConfigObject(this).then((config) => {
            return config.setString(param,value);
        });
    }

    // Gets a Promise -> Stream. The blobPath is relative to the configured
    // target tree.
    getBlob(blobPath) {
        return repoTreeGetTargetTree(this)
            .then((targetTree) => { return repoTreeGetBlob(this,blobPath,targetTree); });
    }

    // Gets a Promise. Walks the tree recursively and calls
    // callback(path,name,streamFunc) for each blob. The "streamFunc" parameter
    // is a function that creates a stream for the blob entry. If specified,
    // filter(path) -> false heads off a particular path branch. The Promise is
    // resolved once all entries have been walked.
    walk(callback,filter) {
        return repoTreeGetTargetTree(this)
            .then((targetTree) => { return repoTreeWalk(this,callback,filter,targetTree); });
    }

    // Gets a Promise -> Boolean. Determines if the specified blob has been
    // modified since its last deployment (i.e. the last commit we
    // deployed). The blob is relative to the configured target tree.
    isBlobModified(blobPath) {
        return Promise.all([
            repoTreeGetPreviousCommit(this)
                .then((commit) => {
                    if (!commit) {
                        return null;
                    }

                    return repoTreeGetTargetTree(this,commit)
                        .then((tree) => {
                            return tree.entryByPath(blobPath)
                                .then((entry) => { return entry; },
                                      (err) => { return Promise.resolve(null); });
                        });
                }),

            repoTreeGetTargetTree(this)
                .then((targetTree) => {
                    return targetTree.entryByPath(blobPath);
                })

        ]).then((entries) => {
            // If the previous entry wasn't found, then report that the blob was
            // modified.
            if (!entries[0]) {
                return true;
            }

            var ids = entries.map((x) => { return x.id(); });
            return !ids[0].equal(ids[1]);
        });
    }

    // Gets a Promise -> Number. Currently this doesn't do anything since it is
    // not required by the implementation.
    getMTime(blobPath) {
        return Promise.resolve(0);
    }
}

class PathTree {
    constructor(basePath) {
        this.name = 'PathTree';
        this.basePath = basePath;

        // Caches Promise -> Number representing the mtime for a blob.
        this.mtimeCache = {};
    }

    // Gets a String. Gets the path to the tree.
    getPath() {
        return this.basePath;
    }

    // Gets a Promise -> String.
    getConfigParameter(param) {
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
    }

    // Not provided for PathTree.
    writeConfigParameter(param,value) {
        assert(false);
    }

    // Gets a Promise -> Stream.
    getBlob(blobPath) {
        // Qualify the blobPath with the tree's base path.
        var blobPathQualified = path.join(this.basePath,blobPath);

        return new Promise((resolve,reject) => {
            try {
                resolve(fs.createReadStream(blobPathQualified));
            } catch (err) {
                reject(err);
            }
        });
    }

    // Gets a Promise. Walks the tree and calls callback(path,name,streamFunc)
    // for each blob. The "streamFunc" parameter can be called to obtain a
    // stream to the blob's contents. If specified, filter(path) -> false heads
    // off a particular branch path.
    walk(callback,filter) {
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
                            callback(basePath,files[i],() => { return fs.createReadStream(filePath); });
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
    }

    // Gets Promise -> Boolean. For path trees, an extra mtime parameter must be
    // provided against which to check for modification.
    isBlobModified(blobPath,mtime) {
        return this.getMTime(blobPath).then((tm) => {
            return tm > mtime;
        });
    }

    // Gets Promise -> Number. Obtains the modification time for the specified
    // blob under the path tree.
    getMTime(blobPath) {
        if (blobPath in this.mtimeCache) {
            return this.mtimeCache[blobPath];
        }

        return this.mtimeCache[blobPath] = new Promise((resolve,reject) => {
            fs.lstat(path.join(this.basePath,blobPath),(err,stats) => {
                if (err) {
                    if (err.code == 'ENOENT') {
                        resolve(false);
                    }
                    else {
                        reject(err);
                    }
                }
                else {
                    resolve(stats.mtime);
                }
            });
        });
    }
}

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

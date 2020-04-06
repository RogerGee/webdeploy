/**
 * repo-tree.js
 *
 * @module tree/repo-tree
 */

const path = require("path").posix;
const git = require("nodegit");
const { format } = require("util");

const { TreeBase } = require("./");
const configuration = require("../config");
const { makeTargetStream } = require("../target");
const { WebdeployError } = require("../error");

const CONFIG_LAST_DEPLOY = "cache.lastDeploy";

function normalizeTargetTree(targetTree) {
    // The path "/" is the root directory of the repo's target tree. This means
    // the prefix should be empty when doing a lookup.

    if (!targetTree || targetTree == "/") {
        return "";
    }

    return targetTree;
}

function makeBlobStream(blob) {
    // Fake a stream for the content buffer. It doesn't seem nodegit provides
    // the ODB read stream yet (and the default ODB backends don't provide
    // streaming capabilities anyways).

    var bufferStream = makeTargetStream();
    bufferStream.end(blob.content());

    return bufferStream;
}

/**
 * @typedef module:tree/repo-tree~repoTreeOptions
 * @property {string} deployBranch
 *  The branch (i.e. head reference) from which to load the deployment
 *  commit.
 * @property {string} deployTag
 *  The tag (i.e. tag reference) from which to load the deployment commit.
 * @property {string} storeKey
 *  The storage key for all config values that require separation based on
 *  storage path.
 */

/**
 * Represents a tree of potential deploy targets that are sourced from a git
 * repository using nodegit. The tree also can read configuration from the
 * repo's git-config.
 */
class RepoTree extends TreeBase {
    /**
     * Creates a new RepoTree instance.
     *
     * @param {nodegit.Repository} repo
     *  The libgit2 repository object instance to wrap.
     * @param {module:tree/repo-tree~repoTreeOptions} options
     */
    constructor(repo,options) {
        super(options);

        this.name = 'RepoTree';
        this.repo = repo;
        this.gitConfig = null;
        this.gitConfigCache = {};

        // Cache Promises to certain, often-accessed resources.
        this.deployCommits = {};
        this.targetTrees = {};
    }

    // Implements TreeBase.getStorageConfig().
    getStorageConfig(param) {
        // Gets a config value from the git-config.

        return new Promise((resolve,reject) => {
            if (param in this.gitConfigCache) {
                resolve(this.gitConfigCache[param]);
                return;
            }

            this.getConfigObject().then((config) => {
                return config.getStringBuf("webdeploy." + param);

            }).then((buf) => {
                var value = buf.toString('utf8');
                try {
                    value = JSON.parse(value);
                } catch (ex) {
                    // leave value as-is if parsing fails
                }

                this.gitConfigCache[param] = value;
                resolve(value);

            }).catch(reject);
        });
    }

    // Implements TreeBase.writeStorageConfig().
    writeStorageConfig(param,value) {
        if (typeof value === 'object') {
            value = JSON.stringify(value);
        }

        // Force param key under webdeploy section.
        param = "webdeploy." + param;

        if (typeof value == 'Number') {
            return this.getConfigObject().then((config) => {
                config.setInt64(param,value);
            });
        }

        return this.getConfigObject().then((config) => {
            return config.setString(param,value);
        });
    }

    // Implements TreeBase.saveDeployCommit().
    saveDeployCommit(key) {
        var section = this.getStoreSection(CONFIG_LAST_DEPLOY);

        return this.getDeployCommit().then((commit) => {
            var value = commit.id().tostrS();
            return this.writeStorageConfig(section,value);
        });
    }

    // Implements TreeBase.getBlob().
    getBlob(blobPath) {
        return this.getTargetTree().then((targetTree) => {
            return this.getBlobImpl(blobPath,targetTree);
        });
    }

    // Implements TreeBase.walk().
    walk(callback,options) {
        if (options.basePath) {
            var prom = this.getTree(options.basePath);
        }
        else {
            var prom = this.getTargetTree();
        }

        return prom.then((tree) => {
            var filter = options.filter || undefined;
            var basePath = options.basePath || tree.path();

            return this.walkImpl(basePath,tree,callback,filter);
        });
    }

    // Implements TreeBase.walkExtraneous().
    walkExtraneous(callback) {
        // Walks through the previous commit and invokes the callback on each
        // entry that exists in the previous commit but not in the current
        // commit. Essentially this is called on all blobs that no longer exist.

        var currentTree;

        return this.getTargetTree().then((targetTree) => {
            currentTree = targetTree;
            return this.getPreviousCommit();

        }).then((commit) => {
            return this.getTargetTree(commit);

        }).then((tree) => {
            return this.walkExtraneousImpl(tree.path(),tree,currentTree,callback);
        });
    }

    // Implements TreeBase.isBlobModified().
    isBlobModified(blobPath,mtime) {
        var prevreq = this.getPreviousCommit().then((commit) => {
            if (!commit) {
                return null;
            }

            return this.getTargetTree(commit);

        }).then((tree) => {
            return tree.entryByPath(blobPath);

        }).then((entry) => {
            return entry;

        }).catch((err) => {
            return Promise.resolve(null);
        });

        var currentreq = this.getTargetTree().then((targetTree) => {
            return targetTree.entryByPath(blobPath);

        }).catch((err) => {
            return Promise.resolve(null);
        });

        return Promise.all([prevreq,currentreq]).then(([ previousBlob, currentBlob ]) => {
            // If the previous entry wasn't found, then report that the blob was
            // modified.
            if (!previousBlob) {
                return true;
            }

            // If the current entry doesn't exist (i.e. it was removed), then
            // report that the blob was not modified (i.e. there is no action we
            // should take on it).
            if (!currentBlob) {
                return false;
            }

            return !previousBlob.id().equal(currentBlob.id());
        });
    }

    // Implements TreeBase.getMTime().
    getMTime(blobPath) {
        // A RepoTree cannot provide a modified timestamp so we always return 0.
        return Promise.resolve(0);
    }

    ////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////

    getConfigObject() {
        if (this.gitConfig) {
            return Promise.resolve(this.gitConfig);
        }

        return this.repo.config().then((config) => {
            this.gitConfig = config;
            return config;
        });
    }

    getDeployCommit() {
        const COMMIT_KEY = "DEPLOY";

        if (COMMIT_KEY in this.deployCommits) {
            return this.deployCommits[COMMIT_KEY];
        }

        // Attempt to load the deploy commit reference from the options;
        // otherwise we default to the "deployBranch" config value.

        if (this.options.deployBranch) {
            var head = format("refs/heads/%s",this.options.deployBranch);
            var promise = this.repo.getReference(head).then((reference) => {
                return git.Commit.lookup(this.repo, reference.target());
            });
        }
        else if (this.options.deployTag) {
            var tag = format("refs/tags/%s",this.options.deployTag);
            var promise = this.repo.getReference(tag).then((reference) => {
                return git.Commit.lookup(this.repo, reference.target());
            });
        }
        else {
            var promise = this.getStorageConfig("deployBranch").then((deployBranch) => {
                return this.repo.getReference(deployBranch);

            }).then((reference) => {
                return git.Commit.lookup(this.repo, reference.target());

            }).catch((err) => {
                throw new WebdeployError("Cannot determine the deploy branch or tag!");
            });
        }

        this.deployCommits[COMMIT_KEY] = promise;

        return promise;
    }

    getPreviousCommit() {
        // NOTE: The promise resolves to null if the commit was not
        // found. Rejection occurs on any other, unanticipated error.

        const COMMIT_KEY = "DEPLOY-PREV";

        if (COMMIT_KEY in this.deployCommits) {
            return this.deployCommits[COMMIT_KEY];
        }

        var section = this.getStoreSection(CONFIG_LAST_DEPLOY);
        var promise = this.getStorageConfig(section).then((previousCommitOid) => {
            return this.repo.getCommit(previousCommitOid);

        }, (err) => {
            return Promise.resolve(null);
        });

        this.deployCommits[COMMIT_KEY] = promise;

        return promise;
    }

    getTree(treePath,commit) {
        function callback(commit) {
            return commit.getTree().then((tree) => {
                if (treePath == "") {
                    return tree;
                }

                return tree.getEntry(treePath).then((entry) => {
                    if (!entry.isTree()) {
                        return Promise.reject(new WebdeployError("Path does not refer to tree"));
                    }

                    return entry.getTree();
                });
            });
        }

        if (!commit) {
            // Default to current deploy commit.
            return this.getDeployCommit().then(callback);
        }

        return callback(commit);
    }

    getTargetTree(commit) {
        if (commit) {
            var commitId = commit.id().tostrS();
        }
        else {
            var commitId = 'target';
        }

        if (this.targetTrees[commitId]) {
            return this.targetTrees[commitId];
        }

        var promise = this.getStorageConfig('targetTree').then((targetTreePath) => {
            return this.getTree(normalizeTargetTree(targetTreePath),commit);

        }, (err) => {
            return this.getTree(normalizeTargetTree(),commit);
        });

        this.targetTrees[commitId] = promise;

        return promise;
    }

    getBlobImpl(blobPath,tree) {
        return tree.getEntry(blobPath).then((entry) => {
            if (!entry.isBlob()) {
                return Promise.reject(new WebdeployError("Path does not refer to a blob"));
            }

            return entry.getBlob();

        }).then(makeBlobStream);
    }

    walkImpl(prefix,tree,callback,filter) {
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
                    this.repo.getBlob(ent.oid()).then((blob) => {
                        try {
                            callback(prefix,ent.name(),() => { return makeBlobStream(blob); });
                        } catch (ex) {
                            reject(ex);
                            return;
                        }
                        attemptResolution();

                    }, reject)
                }
                else if (ent.isTree()) {
                    let newPrefix = path.join(prefix,ent.name());
                    if (!filter || filter(newPrefix)) {
                        outstanding += 1;
                        this.repo.getTree(ent.oid()).then((nextTree) => {
                            return this.walkImpl(newPrefix,nextTree,callback,filter);

                        }, reject).then(attemptResolution);
                    }
                }
            }

            attemptResolution();
        });
    }

    walkExtraneousImpl(prefix,tree,curTree,callback) {
        return new Promise((resolve,reject) => {
            let entries = tree.entries();

            if (entries.length == 0) {
                resolve();
                return;
            }

            let outstanding = entries.length;
            function attemptResolution() {
                if (--outstanding <= 0) {
                    resolve();
                }
            }

            for (let i = 0;i < entries.length;++i) {
                let ent = entries[i];
                let filePath = path.join(prefix,ent.name());

                let evalfn = (curEnt) => {
                    if (ent.isBlob()) {
                        if (!curEnt) {
                            callback(filePath,false);
                        }

                        attemptResolution();
                    }
                    else if (ent.isTree()) {
                        let newPrefix = path.join(prefix,ent.name());

                        this.repo.getTree(ent.oid()).then((nextTree) => {
                            return this.walkExtraneousImpl(newPrefix,nextTree,curTree,callback);

                        }).then(() => {
                            if (!curEnt || !curEnt.isTree()) {
                                callback(filePath,true);
                            }

                            attemptResolution();

                        }).catch(reject);
                    }
                }

                curTree.getEntry(filePath).then(evalfn, (err) => {
                    evalfn(null);
                });
            }
        });
    }

    getStoreSection(section) {
        if (this.options.storeKey) {
            section = format("%s.%s",section,this.options.storeKey);
        }

        return section;
    }
}

module.exports = RepoTree;

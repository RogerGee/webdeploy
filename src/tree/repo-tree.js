/**
 * repo-tree.js
 *
 * @module tree/repo-tree
 */

const path = require("path").posix;
const git = require("nodegit");
const { format } = require("util");

const configuration = require("../config");
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

    var bufferStream = new stream.PassThrough();
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
class RepoTree {
    /**
     * Creates a new RepoTree instance.
     *
     * @param {nodegit.Repository} repo
     *  The libgit2 repository object instance to wrap.
     * @param {module:tree/repo-tree~repoTreeOptions} options
     */
    constructor(repo,options) {
        this.name = 'RepoTree';
        this.repo = repo;
        this.config = {}; // cache git-config entries here
        this.options = options || {};

        // Cache Promises to certain, often-accessed resources.
        this.deployCommits = {};
        this.targetTrees = {};
    }

    /**
     * Adds an option to the tree's internal list of options.
     *
     * @param {string} key
     * @param {string} value
     */
    addOption(key,value) {
        this.options[key] = value;
    }

    /**
     * Gets the path to the tree; since this is a git-repository, this is always
     * null.
     *
     * @return {string}
     */
    getPath() {
        return null;
    }

    /**
     * Looks up a configuration parameter from the repository (i.e. the
     * git-config). The parameter key is automatically qualified with the
     * "webdeploy" prefix.
     *
     * @param {string} param
     *  The parameter to lookup.
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getConfigParameter(param) {
        return this.getConfig(param,true);
    }

    /**
     * NOTE: This method is currently not implemented due to lack of required
     * functionality in nodegit.
     *
     * Looks up an entire configuration section from the git-config.
     *
     * @param {string} section
     *  The name of the section to lookup. The name is automatically qualified
     *  for webdeploy config.
     *
     * @return {Promise<object>}
     *  A Promise that resolves to an Object containing the configuration
     *  properties.
     */
    getConfigSection(section) {
        section = "webdeploy." + section;

        return this.getConfigObject().then((config) => {
            // There is currently no way to implement this with nodegit. (We
            // need something like git_config_foreach_match().) We'll implement
            // this once more bindings are available...

            return {};
        })
    }

    /**
     * Writes a config parameter (i.e. to the git-config).
     *
     * @param {string} param
     *  The name of the config parameter; the name is automatically qualified
     *  for webdeploy config.
     * @param {string} value
     *  The config parameter value.
     *
     * @return {Promise}
     */
    writeConfigParameter(param,value) {
        // Force param key under webdeploy section.
        param = "webdeploy." + param;

        if (typeof value == 'Number') {
            return this.getConfigObject().then((config) => {
                config.setInt64(param,value);
            })
        }

        return this.getConfigObject().then((config) => {
            return config.setString(param,value);
        })
    }

    /**
     * Saves the current deploy commit to the git-config.
     *
     * @return {Promise}
     *  The Promise resolves when the operation completes.
     */
    saveDeployCommit(key) {
        var section = this.getStoreSection(CONFIG_LAST_DEPLOY);

        return this.getDeployCommit().then((commit) => {
            return this.writeConfigParameter(section,commit.id().tostrS());
        })
    }

    /**
     * Gets a blob's contents as a Stream.
     *
     * @param {string} blobPath
     *  The path denoting which blob to lookup. The path is relative to the
     *  configured target tree.
     *
     * @return {Promise<stream.readable>}
     *  Returns a Promise that resolves to a readable stream.
     */
    getBlob(blobPath) {
        return this.getTargetTree().then((targetTree) => {
            return this.getBlobImpl(blobPath,targetTree);
        })
    }

    /**
     * Walks the tree recursively and calls the callback.
     *
     * @param {Function} callback
     *  Function with signature: callback(path,name,streamFunc)
     *   The 'streamFunc' parameter is a function that creates a stream for the
     *   blob entry.
     * @param {object} options
     * @param {Function} options.filter
     *  Function like 'filter(path)' such that 'filter(path) => false' heads off
     *  a particular branch path.
     * @param {string} options.basePath
     *  The base path under the tree representing the starting place for the
     *  walk. NOTE: paths passed to the callback will still be relative to the
     *  target tree.
     *
     * @return {Promise}
     *  The Promise resolves once all entries have been walked.
     */
    walk(callback,options) {
        return this.walk(callback,options);
    }

    /**
     * Determines if the specified blob has been modified since its last
     * deployment (i.e. the last commit we deployed).
     *
     * @param {string} blobPath
     *  The blob path is relative to the configured target tree.
     *
     * @return {Promise<boolean>}
     *  A Promise that resolves to a boolean representing if the blob was
     *  modified.
     */
    isBlobModified(blobPath) {
        return Promise.all([
            this.getPreviousCommit().then((commit) => {
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
            }),

            this.getTargetTree().then((targetTree) => {
                return targetTree.entryByPath(blobPath);

            }).catch((err) => {
                return Promise.resolve(null);
            })

        ]).then((entries) => {
            // If the previous entry wasn't found, then report that the blob was
            // modified.
            if (!entries[0]) {
                return true;
            }

            // If the current entry doesn't exist (i.e. it was removed), then
            // report that the blob was not modified (i.e. there is no action we
            // should take on it).
            if (!entries[1]) {
                return false;
            }

            var ids = entries.map((x) => { return x.id() });
            return !ids[0].equal(ids[1]);
        })
    }

    /**
     * Gets the modified time of the specified blob. Note: this has no real use
     * for RepoTrees and will always produce an mtime of zero.
     *
     * @param {string} blobPath
     *  The blob path is relative to the configured target tree.
     *
     * @return {Promise<number>}
     *  A Promise that resolves to an integer representing the mtime.
     */
    getMTime(blobPath) {
        return Promise.resolve(0);
    }

    /**
     * Walks through all entries in the target tree.
     *
     * @param {Function} callback
     * @param {object} options
     *
     * @return {Promise}
     *  The promise returns after all entries have been walked.
     */
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
        })
    }

    /**
     * Walks through the previous commit and invokes the callback on each entry
     * that exists in the previous commit but not in the current
     * commit. Essentially this is called on all blobs that no longer exist.
     *
     * @param {Function} callback
     *  Callback having signature: callback(path)
     *
     * @return {Promise}
     *  Returns a Promise that resolves after all entries have been walked.
     */
    walkExtraneous(callback) {
        var currentTree;

        return this.getTargetTree().then((targetTree) => {
            currentTree = targetTree;
            return this.getPreviousCommit();

        }).then((commit) => {
            return this.getTargetTree(commit);

        }).then((tree) => {
            return this.walkExtraneousImpl(tree.path(),tree,currentTree,callback);
        })
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
        })
    }

    getConfig(param,useLocalConfig) {
        // RepoTrees look up configuration parameters from the combined
        // git-config and target tree configuration pools. The target tree
        // configuration pool has precedence.

        return new Promise((resolve,reject) => {
            if (this.config && this.config[param]) {
                resolve(this.config[param]);
            }
            else if (useLocalConfig && !this.fileConfig) {
                configuration.loadFromTree(this).then((config) => {
                    this.fileConfig = config;
                    this.getConfig(param,useLocalConfig).then(resolve,reject);

                }, reject)
            }
            else if (useLocalConfig && this.fileConfig[param]) {
                resolve(this.fileConfig[param]);
            }
            else {
                this.getConfigObject().then((config) => {
                    return config.getStringBuf("webdeploy." + param);

                }).then((buf) => {
                    this.config[param] = buf.toString('utf8');
                    resolve(this.config[param]);

                }).catch(reject);
            }
        })
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
            })
        }
        else if (this.options.deployTag) {
            var tag = format("refs/tags/%s",this.options.deployTag);
            var promise = this.repo.getReference(tag).then((reference) => {
                return git.Commit.lookup(this.repo, reference.target());
            })
        }
        else {
            var promise = this.getConfig("deployBranch",false).then((deployBranch) => {
                return this.repo.getReference(deployBranch);

            }).then((reference) => {
                return git.Commit.lookup(this.repo, reference.target());

            }).catch((err) => {
                throw new WebdeployError("Cannot determine the deploy branch or tag!");
            })
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
        var promise = this.getConfig(section,false).then((previousCommitOid) => {
            return this.repo.getCommit(previousCommitOid);

        }, (err) => {
            return Promise.resolve(null);
        })

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
                })
            })
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

        var promise = this.getConfig('targetTree',false).then((targetTreePath) => {
            return this.getTree(normalizeTargetTree(targetTreePath),commit);

        }, (err) => {
            return this.getTree(normalizeTargetTree(),commit);
        })

        this.targetTrees[commitId] = promise;

        return promise;
    }

    getBlobImpl(blobPath,tree) {
        return tree.getEntry(blobPath).then((entry) => {
            if (!entry.isBlob()) {
                return Promise.reject(new WebdeployError("Path does not refer to a blob"));
            }

            return entry.getBlob();

        }).then(makeBlobStream)
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
                        callback(prefix,ent.name(),() => { return makeBlobStream(blob) });
                        attemptResolution();

                    }, reject)
                }
                else if (ent.isTree()) {
                    let newPrefix = path.join(prefix,ent.name());
                    if (!filter || filter(newPrefix)) {
                        outstanding += 1;
                        this.repo.getTree(ent.oid()).then((nextTree) => {
                            return this.walkImpl(newPrefix,nextTree,callback,filter);

                        }, reject).then(attemptResolution)
                    }
                }
            }

            attemptResolution();
        })
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
                })
            }
        })
    }

    getStoreSection(section) {
        if (this.options.storeKey) {
            section = format("%s.%s",section,this.options.storeKey);
        }

        return section;
    }
}

module.exports = RepoTree;

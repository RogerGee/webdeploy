// tree.js - webdeploy

const fs = require("fs");
const path = require("path").posix;
const git = require("nodegit");
const stream = require("stream");
const { format } = require("util");

const configuration = require("./config.js");
const { WebdeployError } = require("./error");

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
 * RepoTree
 *
 * Represents a tree of potential deploy targets that are sourced from a git
 * repository using nodegit. The tree also can read configuration from the
 * repo's git-config.
 */
class RepoTree {
    /**
     * Creates a new RepoTree instance.
     *
     * @param Object repo
     *  The libgit2 repository object instance to wrap.
     * @param Object options
     * @param Object options.deployBranch
     *  The branch (i.e. head reference) from which to load the deployment
     *  commit.
     * @param Object options.deployTag
     *  The tag (i.e. tag reference) from which to load the deployment commit.
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
     * @param String key
     * @param String value
     */
    addOption(key,value) {
        this.options[key] = value;
    }

    /**
     * Gets the path to the tree; since this is a git-repository, this is always
     * null.
     *
     * @return String
     */
    getPath() {
        return null;
    }

    /**
     * Looks up a configuration parameter from the repository (i.e. the
     * git-config). The parameter key is automatically qualified with the
     * "webdeploy" prefix.
     *
     * @param String param
     *  The parameter to lookup.
     *
     * @return Promise
     *  Returns a Promise that resolves to a String containing the config
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
     * @param String section
     *  The name of the section to lookup. The name is automatically qualified
     *  for webdeploy config.
     *
     * @return Promise
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
     * @param String param
     *  The name of the config parameter; the name is automatically qualified
     *  for webdeploy config.
     * @param String value
     *  The config parameter value.
     *
     * @return Promise
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
     * @return Promise
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
     * @param String blobPath
     *  The path denoting which blob to lookup. The path is relative to the
     *  configured target tree.
     *
     * @return Promise
     *  Returns a Promise that resolves to a Stream.
     */
    getBlob(blobPath) {
        return this.getTargetTree().then((targetTree) => {
            return this.getBlobImpl(blobPath,targetTree);
        })
    }

    /**
     * Walks the tree recursively and calls the callback.
     *
     * @param Function callback
     *  Function with signature: callback(path,name,streamFunc)
     *   The 'streamFunc' parameter is a function that creates a stream for the
     *   blob entry.
     * @param Object options
     * @param Function options.filter
     *  Function like 'filter(path)' such that 'filter(path) => false' heads off
     *  a particular branch path.
     * @param String options.basePath
     *  The base path under the tree representing the starting place for the
     *  walk. NOTE: paths passed to the callback will still be relative to the
     *  target tree.
     *
     * @return Promise
     *  The Promise resolves once all entries have been walked.
     */
    walk(callback,options) {
        return this.walk(callback,options);
    }

    /**
     * Determines if the specified blob has been modified since its last
     * deployment (i.e. the last commit we deployed).
     *
     * @param String blobPath
     *  The blob path is relative to the configured target tree.
     *
     * @return Promise
     *  Resolves to a Boolean
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

            }, (err) => {
                return Promise.resolve(null);
            }),

            this.getTargetTree().then((targetTree) => {
                return targetTree.entryByPath(blobPath);
            })

        ]).then((entries) => {
            // If the previous entry wasn't found, then report that the blob was
            // modified.
            if (!entries[0]) {
                return true;
            }

            var ids = entries.map((x) => { return x.id() });
            return !ids[0].equal(ids[1]);
        })
    }

    /**
     * Gets the modified time of the specified blob. Note: this has no real use
     * for RepoTrees and will always produce an mtime of zero.
     *
     * @param String blobPath
     *  The blob path is relative to the configured target tree.
     *
     * @return Promise
     *  A Promise that resolves to an integer representing the mtime.
     */
    getMTime(blobPath) {
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

    walk(callback,options) {
        if (options.basePath) {
            var prom = this.getTree(options.basePath);
        }
        else {
            var prom = this.getTargetTree();
        }

        return prom.then(tree => {
            var filter = options.filter || undefined;
            var basePath = options.basePath || tree.path();

            return this.walkImpl(basePath,tree,callback,filter);
        })
    }

    getStoreSection(section) {
        if (this.options.storeKey) {
            section = format("%s.%s",section,this.options.storeKey);
        }

        return section;
    }
}

/**
 * PathTree
 *
 * Represents a tree of potential deploy targets that are sourced from the
 * filesystem (i.e. under a path on disk).
 */
class PathTree {
    /**
     * Creates a new PathTree instance.
     *
     * @param String basePath
     *  The base path of the filesystem tree.
     * @param Object options
     */
    constructor(basePath,options) {
        this.name = 'PathTree';
        this.basePath = basePath;
        this.options = options || {};

        // Caches Promise -> Number representing the mtime for a blob.
        this.mtimeCache = {};
    }

    /**
     * Adds an option to the tree's internal list of options.
     *
     * @param String key
     * @param String value
     */
    addOption(key,value) {
        this.options[key] = value;
    }

    /**
     * Gets the base path to the tree.
     *
     * @return String
     */
    getPath() {
        return this.basePath;
    }

    /**
     * Looks up a configuration parameter from the local file configuration
     * located within the path.
     *
     * @param String param
     *  The parameter to lookup.
     *
     * @return Promise
     *  Returns a Promise that resolves to a String containing the config
     *  parameter value.
     */
    getConfigParameter(param) {
        // PathTrees lookup configuration parameters from the local file
        // configuration only.

        return new Promise((resolve,reject) => {
            if (!this.fileConfig) {
                configuration.loadFromTree(this).then((config) => {
                    this.fileConfig = config;
                    this.getConfigParameter(param).then(resolve,reject);

                }, reject)
            }
            else if (this.fileConfig[param]) {
                resolve(this.fileConfig[param]);
            }
            else {
                reject(new WebdeployError("No such configuration parameter: '" + param + "'"));
            }
        })
    }

    /**
     * Not provided for PathTree.
     */
    getConfigSection(section) {
        return Promise.resolve({});
    }

    /**
     * Not provided for PathTree.
     */
    writeConfigParameter(param,value) {
        assert(false);
    }

    /**
     * Not provided for PathTree.
     */
    saveDeployCommit() {
        assert(false);
    }

    /**
     * Gets a blob's contents as a Stream.
     *
     * @param String blobPath
     *  The path denoting which blob to lookup. The path is relative to the
     *  configured path.
     *
     * @return Promise
     *  Returns a Promise that resolves to a Stream.
     */
    getBlob(blobPath) {
        // Qualify the blobPath with the tree's base path.
        var blobPathQualified = path.join(this.basePath,blobPath);

        return new Promise((resolve,reject) => {
            var stream = fs.createReadStream(blobPathQualified);
            stream.on('error',reject);
            stream.on('open',(fd) => {
                resolve(stream);
            })
        })
    }

    /**
     * Walks the tree recursively and calls the callback.
     *
     * @param Function callback
     *  Function with signature: callback(path,name,streamFunc)
     *   The 'streamFunc' parameter is a function that creates a stream for the
     *   blob entry.
     * @param Object options
     * @param Function options.filter
     *  Function like 'filter(path)' such that 'filter(path) => false' heads off
     *  a particular branch path.
     * @param String options.basePath
     *  The base path under the tree representing the starting place for the
     *  walk. NOTE: paths passed to the callback will still be relative to the
     *  target tree.
     *
     * @return Promise
     *  The Promise resolves once all entries have been walked.
     */
    walk(callback,options) {
        var filter = options.filter || undefined;
        if (options.basePath) {
            var basePath = path.join(this.basePath,options.basePath);
        }
        else {
            var basePath = this.basePath;
        }

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
                        let filePath = path.join(basePath,files[i]);
                        let stat = fs.lstatSync(filePath);
                        if (stat.isFile()) {
                            callback(basePath,files[i],() => { return fs.createReadStream(filePath) });
                        }
                        else if (stat.isDirectory()) {
                            if (!filter || filter(files[i])) {
                                outstanding += 1;
                                fs.readdir(filePath,walkRecursive(filePath));
                            }
                        }
                    }

                    attemptResolution();
                }
            }

            fs.readdir(basePath,walkRecursive(this.basePath));
        })
    }

    /**
     * Determines if the specified blob has been modified since its last
     * deployment (i.e. the last commit we deployed).
     *
     * @param String blobPath
     *  The blob path is relative to the configured target tree.
     * @param Number mtime
     *  The last modified time to use for comparison. The Promise will always
     *  resolve to true if this parameter is omitted.
     *
     * @return Promise
     *  Resolves to a Boolean
     */
    isBlobModified(blobPath,mtime) {
        return this.getMTime(blobPath).then((tm) => {
            if (typeof mtime === "undefined") {
                return true;
            }

            return tm > mtime;
        })
    }

    /**
     * Gets the modified time of the specified blob.
     *
     * @param String blobPath
     *  The blob path is relative to base path of the tree.
     *
     * @return Promise
     *  A Promise that resolves to an integer representing the mtime.
     */
    getMTime(blobPath) {
        if (blobPath in this.mtimeCache) {
            return this.mtimeCache[blobPath];
        }

        return this.mtimeCache[blobPath] = new Promise((resolve,reject) => {
            fs.lstat(path.join(this.basePath,blobPath), (err,stats) => {
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
            })
        })
    }
}

/**
 * Creates a new RepoTree for the specified repository.
 *
 * @param String repoPath
 *  The path where the repository lives.
 * @param Object options
 *  Extra options for the RepoTree.
 */
function createRepoTree(repoPath,options) {
    return git.Repository.discover(repoPath,0,"").then((path) => {
        return git.Repository.open(path);

    }).then((repository) => {
        return new RepoTree(repository,options);
    })
}

/**
 * Creates a new PathTree for the specified path in the filesystem.
 *
 * @param String path
 *  The path to load.
 * @param Object options
 *  Extra options for the PathTree.
 */
function createPathTree(path,options) {
    return new Promise((resolve,reject) => {
        fs.stat(path,(err,stats) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(new PathTree(path,options));
        })
    })
}

module.exports = {
    createRepoTree: createRepoTree,
    createPathTree: createPathTree
}

// tree/path-tree

const fs = require("fs");
const path = require("path").posix;
const stream = require("stream");

const configuration = require("../config.js");
const { WebdeployError } = require("../error");

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
            let rejected = false;

            function attemptResolution() {
                if (--outstanding <= 0) {
                    resolve();
                }
            }

            function walkRecursive(basePath) {
                return (err,files) => {
                    if (err) {
                        reject(err);
                        rejected = true;
                    }
                    if (rejected) {
                        return;
                    }

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
     * This function has no effect for PathTree.
     *
     * @return Promise
     *  A Promise that always resolves.
     */
    walkExtraneous() {
        return Promise.resolve();
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

module.exports = PathTree;

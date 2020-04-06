/**
 * path-tree.js
 *
 * @module tree/path-tree
 */

const fs = require("fs");
const path = require("path").posix;

const { TreeBase } = require("./");
const { WebdeployError } = require("../error");

/**
 * Represents a tree of potential deploy targets that are sourced from the
 * filesystem (i.e. under a path on disk).
 */
class PathTree extends TreeBase {
    /**
     * Creates a new PathTree instance.
     *
     * @param {string} basePath
     *  The base path of the filesystem tree.
     * @param {object} options
     */
    constructor(basePath,options) {
        super(options);

        this.name = 'PathTree';
        this.basePath = basePath;

        // Caches Promise -> Number representing the mtime for a blob.
        this.mtimeCache = {};
    }

    // Implements TreeBase.getPath().
    getPath() {
        return this.basePath;
    }

    // Implements TreeBase.getBlob().
    getBlob(blobPath) {
        // Qualify the blobPath with the tree's base path.
        var blobPathQualified = path.join(this.basePath,blobPath);

        return new Promise((resolve,reject) => {
            var stream = fs.createReadStream(blobPathQualified);
            stream.on('error',reject);
            stream.on('open',(fd) => {
                resolve(stream);
            });
        });
    }

    // Implements TreeBase.walk().
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
                            callback(basePath,files[i],() => {
                                return fs.createReadStream(filePath)
                            });
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
        });
    }

    // Implements TreeBase.isBlobModified().
    isBlobModified(blobPath,mtime) {
        return this.getMTime(blobPath).then((tm) => {
            if (typeof mtime === "undefined") {
                return true;
            }

            return tm > mtime;
        });
    }

    // Implements TreeBase.getMTime().
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
            });
        });
    }
}

module.exports = PathTree;

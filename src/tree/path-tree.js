/**
 * path-tree.js
 *
 * @module tree/path-tree
 */

const fs = require("fs");
const path = require("path");

const { TreeBase } = require("./");
const { WebdeployError } = require("../error");

const STORAGE_FILE_NAME = ".webdeploy-save";

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

        this.init();
    }

    // Implements TreeBase.getPath().
    getPath() {
        return this.basePath;
    }

    // Implements TreeBase.getBlob().
    getBlob(blobPath) {
        blobPath = this.makePath(blobPath);

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
        var basePath = this.makeBasePath(options.basePath);

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
        blobPath = this.makePath(blobPath);

        return this.getMTime(blobPath).then((tm) => {
            if (typeof mtime === "undefined") {
                return true;
            }

            return tm > mtime;
        });
    }

    // Implements TreeBase.getMTime().
    getMTime(blobPath) {
        blobPath = this.makePath(blobPath);

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

    // Implements TreeBase.getStorageConfigAlt().
    getStorageConfigAlt(param,deploySpecific) {
        // NOTE: This alternative storage mechanism does not implement
        // deploy-specific storage.

        if (!this.storageConfig) {
            var filePath = path.join(this.basePath,STORAGE_FILE_NAME);

            return new Promise((resolve,reject) => {
                fs.readFile(filePath,{ encoding:'utf8' },(err,data) => {
                    if (!err) {
                        try {
                            this.storageConfig = JSON.parse(data);

                            if (param in this.storageConfig) {
                                resolve(this.storageConfig[param]);
                                return;
                            }

                        } catch (ex) {
                            reject(ex);
                        }
                    }
                    else if (err.code != 'ENOENT') {
                        reject(err);
                        return;
                    }

                    this.storageConfig = {};
                    resolve(null);
                });
            });
        }

        if (this.storageConfig && param in this.storageConfig) {
            return Promise.resolve(this.storageConfig[param]);
        }

        return Promise.resolve(null);
    }

    // Implements TreeBase.writeStorageConfigAlt().
    writeStorageConfigAlt(param,deploySpecific,value) {
        // NOTE: This alternative storage mechanism does not implement
        // deploy-specific storage.

        if (!this.storageConfig) {
            this.storageConfig = {};
        }

        this.storageConfig[param] = value;

        return Promise.resolve();
    }

    // Implements TreeBase.finalize().
    finalize() {
        if (!this.storageConfig) {
            this.storageConfig = {};
        }

        var filePath = path.join(this.basePath,STORAGE_FILE_NAME);
        var text = JSON.stringify(this.storageConfig);
        var options = {
            encoding: 'utf8'
        };

        return new Promise((resolve,reject) => {
            fs.writeFile(filePath,text,options,(err) => {
                err ? reject(err) : resolve();
            });
        });
    }

    makePath(pathInTree) {
        var basePath = '';

        // Integrate the target tree parameter into the path.
        var targetTree = this.getDeployConfig('targetTree');
        if (targetTree) {
            basePath = path.join(basePath,targetTree);
        }

        // Integrate the target tree base path (via options).
        var basePathOption = this.option('basePath');
        if (basePathOption) {
            basePath = path.join(basePath,basePathOption);
        }

        return path.join(basePath,pathInTree);
    }

    makeBasePath(suffix) {
        // Determine base path to content we care about in the tree.

        var basePath = this.basePath;

        // Integrate the 'targetTree' deploy config parameter.
        var targetTree = this.getDeployConfig('targetTree');
        if (targetTree) {
            basePath = path.join(basePath,targetTree);
        }

        // Integrate the target tree base path (via options).
        var basePathOption = this.option('basePath');
        if (basePathOption) {
            basePath = path.join(basePath,basePathOption);
        }

        // Integrate provided suffix.
        if (suffix) {
            basePath = path.join(basePath,suffix);
        }

        return basePath;
    }
}

module.exports = {
    PathTree
}

/**
 * path-tree.js
 *
 * @module tree/path-tree
 */

const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
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

    // Implements TreeBase.isLocal().
    isLocal() {
        return true;
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
    async walk(callback,options) {
        options = options || {};

        const readdir = promisify(fs.readdir);
        const lstat = promisify(fs.lstat);
        const basePath = this.makeBasePath(options.basePath);

        const stk = [basePath];

        while (stk.length > 0) {
            const dirname = stk.pop();
            const files = await readdir(dirname);
            const targetPath = path.relative(basePath,dirname);

            for (let i = 0;i < files.length;++i) {
                const filePath = path.join(dirname,files[i]);

                const stat = await lstat(filePath);
                if (stat.isFile()) {
                    await callback(
                        {
                            filePath,
                            targetPath,
                            targetName: files[i]
                        },
                        () => {
                            return fs.createReadStream(filePath);
                        }
                    );
                }
                else if (stat.isDirectory()) {
                    if (!options.filter || options.filter(files[i])) {
                        stk.push(filePath);
                    }
                }
            }
        }
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
    getStorageConfigAlt(param) {
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
    writeStorageConfigAlt(param,value) {
        if (!this.storageConfig) {
            this.storageConfig = {};
        }

        this.storageConfig[param] = value;

        return Promise.resolve();
    }

    // Implements TreeBase.finalizeImpl().
    finalizeImpl() {
        if (!this.storageConfig) {
            this.storageConfig = {};
        }

        if (Object.keys(this.storageConfig).length === 0) {
            return Promise.resolve();
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

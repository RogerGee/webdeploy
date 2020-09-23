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

    // Implements TreeBase.testTree().
    async testTree(treePath) {
        treePath = this.makePath(treePath);
        treePath = path.join(this.basePath,treePath);

        const lstat = promisify(fs.lstat);

        try {
            const stats = await lstat(treePath);
            if (stats.isDirectory()) {
                return true;
            }

        } catch (ex) {
            if (ex.code != "ENOENT") {
                throw ex;
            }
        }

        return false;
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

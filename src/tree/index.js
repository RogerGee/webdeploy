/**
 * tree.js
 *
 * @module tree
 */

const configuration = require("../config.js");
const { WebdeployError } = require("../error");

/**
 * Base class for tree handler implementations.
 */
class TreeBase {
    constructor(options) {
        this.options = options || {};
        this.targetConfig = null;
        this.storageConfig = null;
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
     * Gets the path to the tree.
     *
     * @return {string}
     *  The path may be null if the tree implementation does not have a base
     *  path.
     */
    getPath() {
        return null;
    }

    /**
     * Gets a blob's contents as a Stream.
     *
     * @param {string} blobPath
     *  The path denoting which blob to lookup. The path is relative to the
     *  target tree or base path.
     *
     * @return {Promise<stream.Readable>}
     *  Returns a Promise that resolves to a readable stream.
     */
    getBlob(blobPath) {
        throw new WebdeployError("TreeBase.getBlob() must be implemented");
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
        throw new WebdeployError("TreeBase.walk() must be implemented");
    }

    /**
     * Walks through all blobs that no longer exist in the tree. This method
     * only works for tree implementations that support historical snapshots.
     *
     * @param {Function} callback
     *  Callback having signature: callback(path)
     *
     * @return {Promise}
     *  Returns a Promise that resolves after all entries have been walked.
     */
    walkExtraneous(callback) {
        return Promise.resolve();
    }

    /**
     * Determines if the specified blob has been modified since its last
     * deployment (i.e. the last commit we deployed).
     *
     * @param {string} blobPath
     *  The blob path is relative to the configured target tree.
     * @param {Number} mtime
     *  The last modified time to use in determining if a blob was
     *  modified. Note: not all tree implementations actually need to utilize
     *  this parameter but it should be provided anyway.
     *
     * @return {Promise<boolean>}
     *  A Promise that resolves to a boolean representing if the blob was
     *  modified.
     */
    isBlobModified(blobPath,mtime) {
        throw new WebdeployError("TreeBase.isBlobModified() must be implemented");
    }

    /**
     * Gets the modified time of the specified blob.
     *
     * @param {string} blobPath
     *  The blob path is relative to base path of the tree.
     *
     * @return {Promise<number>}
     *  A Promise that resolves to an integer representing the mtime.
     */
    getMTime(blobPath) {
        throw new WebdeployError("TreeBase.getMTime() must be implemented");
    }

    /**
     * Looks up a configuration parameter from the target tree configuration.
     *
     * @param {string} param
     *  The config parameter to lookup.
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getTargetConfig(param) {
        return new Promise((resolve,reject) => {
            if (!this.targetConfig) {
                configuration.loadFromTree(this).then((config) => {
                    this.targetConfig = config;
                    resolve(this.targetConfig[param]);

                }, reject);
            }
            else if (this.targetConfig[param]) {
                resolve(this.targetConfig[param]);
            }
            else {
                reject(new WebdeployError("No such configuration parameter: '" + param + "'"));
            }
        });
    }

    /**
     * Gets a configuration parameter from the tree storage configuration.
     *
     * @param {string} param
     *  The config parameter to lookup.
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getStorageConfig(param) {
        return Promise.reject(new WebdeployError("No such configuration parameter: '" + param + ""));
    }

    /**
     * Writes a config parameter to the tree's storage configuration.
     *
     * @param {string} param
     *  The name of the config parameter.
     * @param {string} value
     *  The config parameter value.
     *
     * @return {Promise}
     */
    writeStorageConfig(param,value) {
        // TODO
    }

    /**
     * Saves the current deploy commit to the storage configuration.
     *
     * @return {Promise}
     *  The Promise resolves when the operation completes.
     */
    saveDeployCommit() {
        // TODO
        //this.writeStorageParameter();
    }
}

module.exports = {
    TreeBase
}

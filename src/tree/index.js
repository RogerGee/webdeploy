/**
 * tree.js
 *
 * @module tree
 */

const configuration = require("../config.js");
const storage = require("../storage.js");
const { WebdeployError } = require("../error");

const TREE_TABLE =
      `CREATE TABLE tree (
         id INTEGER PRIMARY KEY,
         path TEXT,
         target_tree TEXT,
         default_deploy_path TEXT,
         default_deploy_branch TEXT,

         UNIQUE (path)
       )`;

const DEPLOY_TABLE =
      `CREATE TABLE deploy (
         id INTEGER PRIMARY KEY,
         deploy_path TEXT,
         deploy_branch TEXT,
         last_revision TEXT,
         tree_id INTEGER,

         UNIQUE (deploy_path,tree_id),
         FOREIGN KEY (tree_id) REFERENCES tree(id)
       )`;

const STORAGE_TABLE =
      `CREATE TABLE deploy_storage (
         id INTEGER PRIMARY KEY,
         name TEXT,
         value TEXT,
         deploy_id INTEGER,

         UNIQUE (name),
         FOREIGN KEY (deploy_id) REFERENCES deploy(id)
       )`;

storage.once('load', function() {
    storage.ensureSchema('tree',TREE_TABLE);
    storage.ensureSchema('deploy',DEPLOY_TABLE);
    storage.ensureSchema('deploy_storage',STORAGE_TABLE);
});

const DEFAULT_DEPLOY_CONFIG = {
    targetTree: null,
    deployPath: null,
    deployBranch: null,
    deployTag: null,
    lastRevision: null
};

/**
 * Base class for tree handler implementations.
 */
class TreeBase {
    constructor(options) {
        this.options = options || {};
        this.treeId = null;
        this.deployId = null;
        this.targetConfig = null;
        this.deployConfig = null;
        this.deployConfigDirty = false;
        this.storageConfig = null;
    }

    /**
     * Initializes the tree. This must be called by subclasses.
     */
    init() {
        var treeInfo;
        var defaults = {};
        var stmt, info, row;
        var path = this.getPath();

        // Ensure a tree record exists.

        stmt = storage.prepare(
            `SELECT
               id,
               target_tree AS targetTree,
               default_deploy_path AS deployPath,
               default_deploy_branch AS deployBranch
             FROM
               tree
             WHERE
               path = ?`
        );
        row = stmt.get(path);

        if (!row) {
            info = storage.prepare(`INSERT INTO tree (path) VALUES (?)`).run(path);
            treeInfo = {
                id: info.lastInsertRowid,
                targetTree: null,
                deployPath: null,
                deployBranch: null
            };
        }
        else {
            treeInfo = row;
        }
        this.treeId = treeInfo.id;

        // Determine the deploy path and deploy branch. These values are chosen
        // from options first; if not found, then we look at defaults from the
        // tree record.

        var deployPath = this.option('deployPath') || treeInfo.deployPath;
        var deployBranch = this.option('deployBranch') || treeInfo.deployBranch;

        if (!deployPath) {
            throw new WebdeployError("Deployment config missing 'deployPath'");
        }

        // Ensure a deploy record exists for the tree/deploy-path pair and
        // (while we're at it) load the deploy config.

        stmt = storage.prepare(
            `SELECT
               id,
               deploy_path,
               deploy_branch,
               last_revision
             FROM
               deploy
             WHERE
               deploy_path = ? AND tree_id = ?`
        );
        row = stmt.get(deployPath,this.treeId);

        this.deployConfig = Object.assign({},DEFAULT_DEPLOY_CONFIG);
        if (!row) {
            stmt = storage.prepare(
                `INSERT INTO deploy (tree_id,deploy_path,deploy_branch) VALUES (?,?,?)`
            );
            info = stmt.run(this.treeId,deployPath,deployBranch);
            this.deployId = info.lastInsertRowid;
        }
        else {
            this.deployId = row.id;
            Object.assign(this.deployConfig, {
                deployPath: row.deploy_path,
                deployBranch: row.deploy_branch,
                lastRevision: row.last_revision
            });
        }

        // Set target tree. This is always loaded from the tree record.
        this.deployConfig.targetTree = treeInfo.targetTree;

        // Override deploy config with options.
        for (let key in this.deployConfig) {
            var value = this.option(key);
            if (value) {
                this.deployConfig[key] = value;
            }
        }

        this.deployConfigDirty = false;
    }

    /**
     * Gets an option stored in the tree's internal options list.
     *
     * @param {string} key
     *
     * @return {mixed}
     */
    option(key) {
        if (key in this.options) {
            return this.options[key];
        }

        return null;
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
     * Gets the unique path to the tree.
     *
     * @return {string}
     */
    getPath() {
        throw new WebdeployError("TreeBase.getPath() must be implemented");
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
     *  The config parameter to look up.
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
     * Saves the deploy config to disk.
     */
    saveDeployConfig() {
        if (!this.deployConfigDirty) {
            return;
        }

        var stmt = storage.prepare(
            `UPDATE
               deploy
             SET
               deploy_path = ?,
               deploy_branch = ?,
               last_revision = ?
             WHERE
               id = ?`
        );

        stmt.run(
            this.deployConfig.deployPath,
            this.deployConfig.deployBranch,
            this.deployConfig.lastRevision,
            this.deployId
        );

        this.deployConfigDirty = false;
    }

    /**
     * Gets a configuration value from the tree's deploy configuration.
     *
     * @param {string} param
     *  The config parameter to look up.
     *
     * @return {string}
     */
    getDeployConfig(param) {
        if (param in this.deployConfig) {
            return this.deployConfig[param];
        }

        return null;
    }

    /**
     * Writes a deploy config parameter.
     *
     * @param {string} param
     * @param {string} value
     */
    writeDeployConfig(param,value) {
        if (param in this.deployConfig) {
            this.deployConfig[param] = value;
            this.deployConfigDirty = true;
        }
    }

    /**
     * Gets a configuration value from the tree's storage configuration.
     *
     * @param {string} param
     *  The config parameter to look up.
     * @param {bool} [deploySpecific]
     *  If true, then the value is stored
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getStorageConfig(param,deploySpecific) {
        // TODO

        return this.getStorageConfigAlt(...arguments);
    }

    /**
     * Provides an alternative, fallback implementation for reading a
     * configuration value from the tree storage configuration.
     *
     * @param {string} param
     *  The config parameter to lookup.
     * @param {bool} [deploySpecific]
     *  If true, then the value is stored
     *
     * @return {Promise<string>}
     */
    getStorageConfigAlt(param,deploySpecific) {
        return Promise.reject(new WebdeployError("No such configuration parameter: '" + param + ""));
    }

    /**
     * Writes a configuration value to the tree's storage configuration.
     *
     * @param {string} param
     *  The name of the config parameter.
     * @param {bool} deploySpecific
     *  If true, then the value is stored
     * @param {string} value
     *  The config parameter value.
     * @param {function} donefn
     *  Called when the operation completes; donefn(err)
     */
    writeStorageConfig(param,deploySpecific,value,donefn) {
        // TODO

        this.writeStorageConfigAlt(...arguments);
    }

    /**
     * Provides an alternative, fallback implementation for writing a
     * configuration value to the tree's storage configuration.
     *
     * @param {string} param
     *  The name of the config parameter.
     * @param {bool} deploySpecific
     *  If true, then the value is stored
     * @param {string} value
     *  The config parameter value.
     *
     * @return {Promise}
     */
    writeStorageConfigAlt(param,deploySpecific,value) {
        return Promise.reject(new WebdeployError("Writing to storage configuration is not supported"));
    }

    /**
     * Finalizes the tree storage. This should be called to ensure storage is
     * written out.
     *
     * @return {Promise}
     *  Returns a Promise that resolves when the operation is complete.
     */
    finalize() {
        return this.finalizeImpl().then(() => {
            this.saveDeployConfig();
        });
    }

    /**
     * Finalize method reserved for derived class implementation.
     *
     * @return {Promise}
     *  Returns a Promise that resolves when the operation is complete.
     */
    finalizeImpl() {
        return Promise.resolve();
    }
}

module.exports = {
    TreeBase
}

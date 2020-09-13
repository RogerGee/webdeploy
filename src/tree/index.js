/**
 * tree.js
 *
 * @module tree
 */

const path = require("path");

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

         UNIQUE (name,deploy_id),
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

function normalizeTreePath(path) {
    // Force the tree path to be the same for both 'path' and 'repo'
    // trees. Since conventionally, a repo path ends in a trailing '.git'
    // component, we remove this component so that 'path' and 'repo' trees have
    // the same path.

    var treePath = path;
    var match = treePath.match(/^(.+)\/\.git\/?$/);

    if (match) {
        treePath = match[1]
    }

    return treePath;
}

function normalizeTargetTree(targetTree) {
    if (!targetTree) {
        return null;
    }

    var match = targetTree.match(/^\/+(.*)/);
    if (match) {
        targetTree = match[1];
    }

    if (!targetTree) {
        return null;
    }

    return targetTree;
}

/**
 * Base class for tree handler implementations.
 */
class TreeBase {
    /**
     * @param {object} options
     * @param {string} [options.deployPath]
     *  The deploy path for the tree deployment. If not specified, then the
     *  default deploy path from the tree record will be used.
     * @param {string} [options.deployBranch]
     *  The deploy branch for the tree deployment. If not specified, then the
     *  default deploy branch from the tree record will be used.
     * @param {boolean} [options.createDeployment]
     *  Indicates whether the tree should create a deployment record. This
     *  defaults to true.
     */
    constructor(options) {
        this.options = options || {};
        this.treeRecord = null;
        this.deployId = null;
        this.targetConfig = null;
        this.deployConfig = null;
        this.storageConfig = null;

        this.dirty = {
            treeRecord: false,
            deployConfig: false
        };
    }

    /**
     * Initializes the tree. This must be called by the subclass before the tree
     * is used.
     */
    init() {
        var defaults = {};
        var stmt, info, row;
        var path = this.getPath();

        // Ensure a tree record exists. We normalize the tree path so that the
        // record is shared between 'path' and 'repo' tree variants.

        var treePath = normalizeTreePath(path);

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
        row = stmt.get(treePath);

        if (!row) {
            if (this.option("createTree") === false) {
                return;
            }

            info = storage.prepare(`INSERT INTO tree (path) VALUES (?)`).run(treePath);
            this.treeRecord = {
                id: info.lastInsertRowid,
                targetTree: null,
                deployPath: null,
                deployBranch: null
            };
        }
        else {
            this.treeRecord = row;
        }

        // Determine the deploy path and deploy branch. These values are chosen
        // from options first; if not found, then we look at defaults from the
        // tree record.

        var deployPath = this.option('deployPath') || this.treeRecord.deployPath || treePath;
        var deployBranch = this.option('deployBranch') || this.treeRecord.deployBranch;

        if (!deployPath && this.option('createDeployment') !== false) {
            throw new WebdeployError("Deployment config missing 'deployPath'");
        }

        // Ensure a deploy record exists for the tree/deploy-path pair and
        // (while we're at it) load the deploy config. We only ensure a deploy
        // record if 'createDeployment' is false.

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
        row = stmt.get(deployPath,this.treeRecord.id);

        this.deployConfig = Object.assign({},DEFAULT_DEPLOY_CONFIG);
        if (!row) {
            if (this.option('createDeployment') === false) {
                this.deployId = null;
            }
            else {
                stmt = storage.prepare(
                    `INSERT INTO deploy (tree_id,deploy_path,deploy_branch) VALUES (?,?,?)`
                );
                info = stmt.run(this.treeRecord.id,deployPath,deployBranch);
                this.deployId = info.lastInsertRowid;
            }

            this.deployConfig.deployPath = deployPath;
            this.deployConfig.deployBranch = deployBranch;
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
        this.deployConfig.targetTree = normalizeTargetTree(this.treeRecord.targetTree);

        // Override deploy config with options.
        for (let key in this.deployConfig) {
            var value = this.option(key);
            if (value) {
                this.deployConfig[key] = value;
            }
        }

        this.dirty.treeRecord = false;
        this.dirty.deployConfig = false;
    }

    /**
     * Determines if the tree has a deployment record.
     *
     * @return {boolean}
     */
    hasDeployment() {
        return this.deployId >= 1;
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
     * Gets the path to the tree relative to the current working directory.
     *
     * @return {string}
     */
    getRelativePath() {
        return path.relative('',this.getPath());
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
     *  target tree and target tree base path.
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
     * Determines if the tree exists as a webdeploy project tree.
     *
     * @return {boolean}
     */
    exists() {
        return !!this.treeRecord;
    }

    /**
     * Gets the tree record associated with the tree.
     *
     * @return {object}
     */
    getTreeRecord() {
        if (this.treeRecord) {
            var cpy = Object.assign({},this.treeRecord);
            delete cpy['id'];
            return cpy;
        }

        throw new WebdeployError("Tree does not exist");
    }

    /**
     * Writes a property to the tree record.
     *
     * @param {string} param
     * @param {string} value
     */
    writeTreeRecord(key,value) {
        if (!this.treeRecord) {
            throw new WebdeployError("Tree does not exist");
        }

        if (key in this.treeRecord && key != 'id') {
            this.treeRecord[key] = value;
            this.dirty.treeRecord = true;
            return true;
        }

        return false;
    }

    /**
     * Saves the tree record info to disk.
     */
    saveTreeRecord() {
        if (!this.treeRecord) {
            throw new WebdeployError("Tree does not exist");
        }

        if (!this.dirty.treeRecord) {
            return;
        }

        var stmt = storage.prepare(
            `UPDATE
               tree
             SET
               default_deploy_path = ?,
               default_deploy_branch = ?,
               target_tree = ?
             WHERE
               id = ?`
        );

        stmt.run(
            this.treeRecord.deployPath,
            this.treeRecord.deployBranch,
            this.treeRecord.targetTree,
            this.treeRecord.id
        );

        this.dirty.treeRecord = false;
    }

    /**
     * Looks up a configuration parameter from the target tree configuration.
     *
     * @param {string} param
     *  The config parameter to look up.
     * @param {boolean} [optional]
     *  If true, then the promise resolves to 'null' when the parameter is not
     *  found.
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getTargetConfig(param,optional) {
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
                if (optional) {
                    resolve(null);
                }
                else {
                    reject(new WebdeployError("No such configuration parameter: '" + param + "'"));
                }
            }
        });
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
     *
     * @return {boolean}
     */
    writeDeployConfig(param,value) {
        if (param in this.deployConfig) {
            this.deployConfig[param] = value;
            this.dirty.deployConfig = true;
            return true;
        }

        return false;
    }

    /**
     * Saves the deploy config to disk.
     */
    saveDeployConfig() {
        if (!this.dirty.deployConfig || !this.deployId) {
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

        this.dirty.deployConfig = false;
    }

    /**
     * Deletes the deploy record associated with the tree.
     */
    purgeDeploy(purgeTree) {
        const stmts = [];
        const vals = [];

        if (this.hasDeployment()) {
            stmts.push(
                storage.prepare(
                    `DELETE FROM deploy_storage WHERE deploy_id = ?`
                )
            );
            vals.push([this.deployId]);

            stmts.push(
                storage.prepare(
                    `DELETE FROM deploy WHERE id = ?`
                )
            );
            vals.push([this.deployId]);
        }

        if (purgeTree && this.exists()) {
            stmts.push(
                storage.prepare(
                    `DELETE FROM tree WHERE id = ?`
                )
            );
            vals.push([this.treeRecord.id]);
        }

        if (stmts.length == 0) {
            return;
        }

        const tr = storage.transaction(() => {
            for (let i = 0;i < stmts.length;++i) {
                stmts[i].run(...vals[i]);
            }

            if (purgeTree) {
                this.dirty.treeRecord = false;
            }
            this.dirty.deployConfig = false;
        });

        tr();
    }

    /**
     * Gets a configuration value from the tree's storage configuration.
     *
     * @param {string} param
     *  The config parameter to look up.
     *
     * @return {Promise<string>}
     *  Returns a Promise that resolves to a string containing the config
     *  parameter value.
     */
    getStorageConfig(param) {
        var stmt = storage.prepareCache(
            'tree.getStorageConfig',
            `SELECT value FROM deploy_storage WHERE name = ? AND deploy_id = ?`
        );

        var row = stmt.get(param,this.deployId);
        if (!row) {
            return this.getStorageConfigAlt(...arguments);
        }

        try {
            var value = JSON.parse(row.value);
        } catch (ex) {
            return Promise.reject(ex);
        }

        return Promise.resolve(value);
    }

    /**
     * Provides an alternative, fallback implementation for reading a
     * configuration value from the tree storage configuration.
     *
     * @param {string} param
     *  The config parameter to lookup.
     *
     * @return {Promise<string>}
     */
    getStorageConfigAlt(param) {
        return Promise.reject(new WebdeployError("No such configuration parameter: '" + param + ""));
    }

    /**
     * Writes a configuration value to the tree's storage configuration.
     *
     * @param {string} param
     *  The name of the config parameter.
     * @param {*} value
     *  The config parameter value.
     *
     * @return {Promise}
     */
    writeStorageConfig(param,value) {
        var stmt = storage.prepareCache(
            'tree.writeStorageConfig',
            `INSERT INTO deploy_storage (name,value,deploy_id) VALUES (?,?,?)
             ON CONFLICT(name,deploy_id) DO
               UPDATE SET value=excluded.value`
        );

        var err = false;

        try {
            stmt.run(param,JSON.stringify(value),this.deployId);
        } catch (ex) {
            const { SqliteError } = require('better-sqlite3');

            if (ex instanceof SqliteError) {
                err = true;
            }
            else {
                throw ex;
            }
        }

        // Fallback to alternate storage mechanism if write fails.
        if (err) {
            return this.writeStorageConfigAlt(...arguments);
        }

        return Promise.resolve();
    }

    /**
     * Provides an alternative, fallback implementation for writing a
     * configuration value to the tree's storage configuration.
     *
     * @param {string} param
     *  The name of the config parameter.
     * @param {*} value
     *  The config parameter value.
     *
     * @return {Promise}
     */
    writeStorageConfigAlt(param,value) {
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
            this.saveTreeRecord();
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
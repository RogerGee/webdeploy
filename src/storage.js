/**
 * storage.js
 *
 * @module storage
 */

const { format } = require("util");
const Database = require("better-sqlite3");

const sysconfig = require("./sysconfig");

const CONFIG_TABLE =
      `CREATE TABLE config (
         config_key VARCHAR,
         config_value VARCHAR,
         UNIQUE(config_key)
       );`;

/**
 * @typedef module:storage~RevisionObject
 * @property {string} script
 *  SQL code used to alter the schema.
 */

/**
 * Represents the storage database
 */
class StorageDatabase {
    /**
     * Creates a new StorageDatabase instance. You should not create one of
     * these directly, since we export a singleton in this module for global
     * use.
     */
    constructor() {
        this.db = null;
        this.preps = {};
    }

    /**
     * Loads the storage database instance so that it is ready for use. This
     * method is always called during bootstrapping and should not be called
     * directly.
     */
    load() {
        this.db = new Database(sysconfig.storageFile);

        // Install config schema.
        this.ensureSchema('config',CONFIG_TABLE);
    }

    /**
     * Ensures that the specified schema is installed.
     *
     * @param {string} key
     *  A unique identifier for the schema.
     * @param {string} sql
     *  SQL code to create the necessary schema
     * @param {module:storage~RevisionObject[]} [revisions]
     *  A list of revision objects for updating the schema. The order of the
     *  revisions is important.
     *
     * @return {boolean}
     *  Returns true if the schema needed to be installed or updated, false
     *  otherwise.
     */
    ensureSchema(key,sql,revisions) {
        var configKey = format('core.schema.%s',key);
        try {
            var schemaInfo = this.lookupConfig(configKey);
        } catch (err) {
            if (err instanceof Database.SqliteError && err.message.match(/no such table/)) {
                schemaInfo = null;
            }
            else {
                throw err;
            }
        }

        if (typeof revisions == 'undefined') {
            revisions = [];
        }
        var number = revisions.length;

        if (schemaInfo) {
            // Check to see if we need to apply revisions. We only do this for a
            // schema that has already been installed.
            if (number <= schemaInfo.number) {
                return false;
            }

            for (let i = schemaInfo.number;i < number;++i) {
                this.db.exec(revisions[i].script);
            }

            schemaInfo.number = number;
        }
        else {
            var schemaInfo = {
                key,
                number
            }

            this.db.exec(sql);
        }

        this.writeConfig(configKey,schemaInfo);

        return true;
    }

    /**
     * Looks up a stored config value.
     *
     * @param {string} key
     *  The configuration key to query.
     *
     * @return {*}
     *  Will return 'undefined' on failure.
     */
    lookupConfig(key) {
        var sql = "SELECT config_value FROM config WHERE config_key = ?";
        var stmt = this.prepare('config:select',sql);
        var row = stmt.get(key);

        if (!row) {
            return row;
        }

        return JSON.parse(row.config_value);
    }

    /**
     * @param {string} key
     *  The configuration key to query.
     * @param {*} value
     *  Value to store; this value is converted to JSON for storage.
     */
    writeConfig(key,value) {
        var insert = this.prepare("config:insert","INSERT INTO config (config_key,config_value) VALUES (?,?)");
        var update = this.prepare("config:update","UPDATE config SET config_value = ? WHERE config_key = ?");

        var transaction = this.db.transaction(function(key,value) {
            try {
                insert.run(key,value)
            } catch (err) {
                update.run(value,key);
            }
        });

        transaction(key,JSON.stringify(value));
    }

    /**
     * Prepares a cached Statement instance.
     *
     * @param {string} key
     *  Key used to index cached entry.
     * @param {string} sql
     *  The SQL code to use to create the prepared statement.
     *
     * @return {Statement}
     */
    prepare(key,sql) {
        if (key in this.preps) {
            return this.preps[key];
        }

        var stmt = this.db.prepare(sql);
        this.preps[key] = stmt;

        return stmt;
    }
}

/**
 * Singleton storage database instance.
 *
 * @type {module:storage~StorageDatabase}
 */
module.exports = new StorageDatabase();

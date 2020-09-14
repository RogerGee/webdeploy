/**
 * subsystem.js
 *
 * @module subsystem
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const storage = require("./storage");
const { promisify } = require("util");
const { mkdirParents } = require("./utils");

const HOMEDIR = os.homedir();
const DEFAULT_ROOT = path.join(HOMEDIR,'.webdeploy');

/**
 * Core webdeploy subsystem functionality.
 */
class Subsystem {
    /**
     * Creates a new Subsystem instance.
     */
    constructor() {
        this.pluginDirectories = [];
        this.configFile = this.makePath("webdeployrc");
        this.storageFile = this.makePath("storage.db");

        // Add the 'plugins' directory under the webdeploy distribution to the
        // list of plugin directories. This is designed for testing purposes.
        this.pluginDirectories.push(
            path.resolve(path.join(__dirname,"../plugins"))
        );
    }

    makePath(...parts) {
        let basePath;
        if (process.env.WEBDEPLOY_ROOT) {
            basePath = process.env.WEBDEPLOY_ROOT;
        }
        else {
            basePath = DEFAULT_ROOT;
        }

        return path.join(basePath,...parts);
    }

    /**
     * Loads the subsystem. This must be called before any major functionality
     * from this package is used.
     */
    async load() {
        // Make sure the root directory exists.
        await mkdirParents(DEFAULT_ROOT,HOMEDIR);

        await this._loadConfig();

        storage.load(this.storageFile);
    }

    async _loadConfig() {
        let data;
        const readFile = promisify(fs.readFile);

        try {
            data = await readFile(this.configFile);
        } catch (err) {
            if (err.code != 'ENOENT') {
                throw err;
            }
        }

        if (data) {
            configPayload = JSON.parse(data);

            // Merge file-based configuration into the global config.

            for (let key in this) {
                if (key in configPayload) {
                    if (Array.isArray(this[key])) {
                        this[key] = this[key].concat(configPayload[key]);
                    }
                    else {
                        this[key] = configPayload[key];
                    }
                }
            }

            // Finalize: ensure storage file is absolute path.
            if (!path.isAbsolute(this.storageFile)) {
                this.storageFile = this.makePath(this.storageFile);
            }
        }
    }
}

/**
 * The singleton subsystem instance.
 *
 * @type {module:subsystem~Subsystem}
 */
module.exports = new Subsystem();

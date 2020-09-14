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
const { WebdeployError } = require("./error");

const HOMEDIR = os.homedir();
const DEFAULT_ROOT = path.join(HOMEDIR,".webdeploy");

const PROXY_FILE = ".webdeploy.proxy.js";
const PROXY_CODE = `
// webdeploy proxy snippet
module.exports = require;
`;

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

        this.proxy = null;

        // Add the 'plugins' directory under the webdeploy distribution to the
        // list of plugin directories. This is designed for testing purposes.
        this.pluginDirectories.push(
            path.resolve(path.join(__dirname,"../plugins"))
        );
    }

    /**
     * Requires a node module from the current project. The module is loaded
     * from the project via a proxy module.
     *
     * @param {string} path
     *
     * @return {*}
     */
    requireProject(path) {
        if (!this.proxy) {
            throw new WebdeployError("Project module proxy is not configured");
        }

        if (this.proxy === true) {
            return null;
        }

        return this.proxy(path);
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

    /**
     * Configures the subsystem for the given project tree.
     *
     * @param {module:tree~TreeBase} tree
     */
    async loadProject(tree) {
        const proxyPath = path.join(tree.getPath(),"node_modules",PROXY_FILE);
        const stat = promisify(fs.stat);

        let err;
        try {
            const results = await stat(proxyPath);
            if (!results.isFile()) {
                err = new WebdeployError(
                    "Proxy could not be established: '%s' is not a file",
                    proxyPath
                );
            }

        } catch (ex) {
            if (ex.code == "ENOENT") {
                const writer = fs.createWriteStream(proxyPath);
                writer.end(PROXY_CODE);

                await new Promise((resolve,reject) => {
                    writer.on("finish",resolve);
                    writer.on("error",reject);
                });
            }
            else {
                err = ex;
            }
        }

        if (err) {
            throw err;
        }

        this.proxy = require(proxyPath);
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

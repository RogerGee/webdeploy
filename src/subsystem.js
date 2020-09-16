/**
 * subsystem.js
 *
 * @module subsystem
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const storage = require("./storage");
const logger = require("./logger");
const { promisify } = require("util");
const { mkdirParents, flattenPath, runNPM } = require("./utils");
const { WebdeployError } = require("./error");

const HOMEDIR = os.homedir();
const DEFAULT_ROOT = path.join(HOMEDIR,".webdeploy");

const PROXY_FILE = ".webdeploy.proxy.js";
const PROXY_CODE = `
// webdeploy proxy snippet
module.exports = require;
`;

const NODE_MODULES_SUBPATH = "node-modules";

class PackageFile {
    constructor(readStream,outputPath) {
        this.readStream = readStream;
        this.outputPath = outputPath;
    }

    writeOut() {
        const writer = fs.createWriteStream(this.outputPath);

        return new Promise((resolve,reject) => {
            this.readStream.pipe(writer);
            this.readStream.on("end",resolve);
            this.readStream.on("error",reject);
        });
    }
}

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

        this.nodeModules = false;
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
        this.nodeModules = await this._checkNodeModules(tree);
        if (!this.nodeModules) {
            this.proxy = true;
            return;
        }

        const proxyPath = path.join(this.nodeModules,PROXY_FILE);

        try {
            const results = await promisify(fs.stat)(proxyPath);
            if (!results.isFile()) {
                throw new WebdeployError(
                    "Proxy could not be established: '%s' is not a file",
                    proxyPath
                );
            }

        } catch (ex) {
            if (ex.code != "ENOENT") {
                throw ex;
            }

            const writer = fs.createWriteStream(proxyPath);
            writer.end(PROXY_CODE);

            await new Promise((resolve,reject) => {
                writer.on("finish",resolve);
                writer.on("error",reject);
            });
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
            const configPayload = JSON.parse(data);

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

    async _checkNodeModules(tree) {
        let dir;
        if (tree.isLocal()) {
            dir = path.join(tree.getPath(),"node_modules");
        }
        else {
            dir = this.makePath(NODE_MODULES_SUBPATH,"PROJ"+flattenPath(tree.getPath()));
        }

        try {
            const stats = await promisify(fs.stat)(dir);
            if (!stats.isDirectory() && !tree.isLocal()) {
                throw new WebdeployError("Project cannot load: '%s' must be a directory",dir);
            }

            if (!tree.isLocal()) {
                await this._installNodeModules(tree,dir,true);
            }

        } catch (ex) {
            if (ex.code != "ENOENT") {
                throw ex;
            }

            // Local trees do not require node_modules.
            if (tree.isLocal()) {
                return false;
            }

            // Create node_modules under path using package.json and
            // package-lock.json.
            if (!(await this._installNodeModules(tree,dir,false))) {
                return false;
            }
        }

        return dir;
    }

    async _installNodeModules(tree,dir,incremental) {
        // Skip if package and package-lock were not modified.
        if (incremental
            && !(await tree.isBlobModified("package.json"))
            && !(await tree.isBlobModified("package-lock.json")))
        {
            return true;
        }

        // Load files needed for node_modules deployment.
        const files = [];
        try {
            files.push(
                new PackageFile(
                    await tree.getBlob("package.json"),
                    path.join(dir,"package.json")
                )
            );
            files.push(
                new PackageFile(
                    await tree.getBlob("package-lock.json"),
                    path.join(dir,"package-lock.json")
                )
            );
        } catch (ex) {
            // If package files were not found then we ignore node_modules.
            return false;
        }

        if (!incremental) {
            // Ensure directory exists.
            await mkdirParents(dir,this.makePath());
        }

        if (incremental) {
            logger.log("Updating node_modules...");
        }
        else {
            logger.log("Installing node_modules...");
        }
        logger.pushIndent();

        for (let i = 0;i < files.length;++i) {
            await files[i].writeOut();
        }

        const args = [
            "install",
            "-s",
            "--no-audit",
            "--no-bin-links"
        ];

        await promisify(runNPM)(args,dir,false);

        logger.log("*Done*");
        logger.popIndent();

        return true;
    }
}

/**
 * The singleton subsystem instance.
 *
 * @type {module:subsystem~Subsystem}
 */
module.exports = new Subsystem();

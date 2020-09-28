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
const { mkdirParents, flattenPath, runNPM, runPNPM } = require("./utils");
const { WebdeployError } = require("./error");

const HOMEDIR = os.homedir();
const DEFAULT_ROOT = path.join(HOMEDIR,".webdeploy");

const CONFIG_KEYS = [
    "pluginDirectories",
    "storageFile"
];

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

async function check_lockfile_npm(tree) {
    const lockfile = "package-lock.json";

    if (!(await tree.testBlob(lockfile))) {
        return false;
    }

    return {
        lockfile,
        install: promisify(runNPM),
        args: [
            "ci"
        ]
    };
}

async function check_lockfile_pnpm(tree) {
    const lockfile = "pnpm-lock.yaml";

    if (!(await tree.testBlob(lockfile))) {
        return false;
    }

    return {
        lockfile,
        install: promisify(runPNPM),
        args: [
            "install",
            "--frozen-lockfile"
        ]
    };
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

            for (let key in CONFIG_KEYS) {
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
            dir = await this._findNodeModulesPath(tree.getPath());
        }
        else {
            const stat = promisify(fs.stat);

            dir = this.makePath(NODE_MODULES_SUBPATH,"PROJ"+flattenPath(tree.getPath()));

            try {
                let stats = await stat(dir);
                if (!stats.isDirectory()) {
                    throw new WebdeployError("Node modules: '%s' must be a directory",dir);
                }

                let filepath = path.join(dir,"package.json");

                stats = await stat(filepath);
                if (!stats.isFile()) {
                    throw new WebdeployError("Node modules: '%s' must be a regular file",filepath);
                }

                await this._installNodeModules(tree,dir,true);

            } catch (ex) {
                if (ex.code != "ENOENT") {
                    throw ex;
                }

                // Create node_modules folder.
                if (!(await this._installNodeModules(tree,dir,false))) {
                    dir = false;
                }
            }

            dir = path.join(dir,"node_modules");
        }

        return dir;
    }

    async _findNodeModulesPath(initialBasePath) {
        const stat = promisify(fs.stat);
        let basePath = initialBasePath;
        let dir = path.join(basePath,"node_modules");

        // Search for node_modules similarly to nodejs.

        while (true) {
            try {
                const stats = await stat(dir);
                if (stats.isDirectory()) {
                    return dir;
                }

            } catch (ex) {
                if (ex.code != "ENOENT") {
                    throw ex;
                }

            }

            basePath = path.dirname(basePath);
            const next = path.join(basePath,"node_modules");

            if (next == dir) {
                break;
            }

            dir = next;
        }

        return false;
    }

    async _installNodeModules(tree,dir,incremental) {
        const packageFiles = [];

        try {
            const destPath = path.join(dir,"package.json");
            const stream = await tree.getBlob("package.json");
            packageFiles.push(new PackageFile(stream,destPath));
        } catch (ex) {
            // Skip installing node_modules if the repository has no
            // package.json.
            return false;
        }

        let info;

        // Figure out which kind of node_modules installation we'll do based on
        // the lockfile found in the project tree.
        info = await check_lockfile_npm(tree);
        if (!info) {
            info = await check_lockfile_pnpm(tree);
        }
        if (!info) {
            return false;
        }

        // Skip if lockfile is not modified.
        if (incremental && !(await tree.isBlobModified(info.lockfile))) {
            return true;
        }

        // Ensure directory exists if this is our first time.
        if (!incremental) {
            await mkdirParents(dir,this.makePath());
        }

        // Add lockfile to required files.
        packageFiles.push(
            new PackageFile(
                await tree.getBlob(info.lockfile),
                path.join(dir,info.lockfile)
            )
        );

        if (incremental) {
            logger.log("Updating node_modules...");
        }
        else {
            logger.log("Installing node_modules...");
        }
        logger.pushIndent();

        // Write out files to node_modules directory.
        for (let i = 0;i < packageFiles.length;++i) {
            await packageFiles[i].writeOut();
        }

        // Execute install command.
        await info.install(info.args,dir,false);

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

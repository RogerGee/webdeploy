/**
 * sysconfig.js
 *
 * @module sysconfig
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { mkdirParents } = require("./utils");

const HOMEDIR = os.homedir();
const DEFAULT_ROOT = path.join(HOMEDIR,'.webdeploy');

function make_path(...parts) {
    if (process.env.WEBDEPLOY_ROOT) {
        var basePath = process.env.WEBDEPLOY_ROOT;
    }
    else {
        var basePath = DEFAULT_ROOT;
    }

    return path.join(basePath,...parts);
}

const USER_CONFIG_FILE = make_path('webdeployrc');
const USER_PLUGIN_DIR = make_path('plugin-cache');
const USER_STORAGE_FILE = make_path('storage.db');

const DEFAULTS = {
    pluginDirectories: [],
    pluginCacheDir: USER_PLUGIN_DIR,
    webRepos: [],
    npmRepos: [],
    storageFile: USER_STORAGE_FILE
};

/**
 * Represents the system configuration parameters.
 */
class Sysconfig {
    /**
     * Creates a new Sysconfig instance.
     */
    constructor() {
        // Make sure the default user plugin directory exists. (This also
        // indirectly makes sure the base directory exists.)
        mkdirParents(USER_PLUGIN_DIR,HOMEDIR);

        // Apply defaults.
        Object.assign(this,DEFAULTS);

        // Add the 'plugins' directory under the webdeploy distribution to the
        // list of plugin directories.
        var defaultPluginDir = path.resolve(path.join(__dirname,"../plugins"));
        this.pluginDirectories.push(defaultPluginDir);
    }

    /**
     * Loads the system webdeploy configuration from disk. This optional
     * configuration is stored in a file in the user's home directory.
     *
     * @param {function} donefn
     * @param {function} errfn
     */
    load(donefn,errfn) {
        fs.readFile(USER_CONFIG_FILE, (err,data) => {
            if (err) {
                if (err.code != 'ENOENT') {
                    return errfn(err);
                }
            }
            else {
                try {
                    var configPayload = JSON.parse(data);
                } catch (error) {
                    return errfn(error);
                }

                // Merge file-based configuration into the global config.

                for (var key in this) {
                    if (key in configPayload) {
                        if (Array.isArray(this[key])) {
                            this[key] = this[key].concat(configPayload[key]);
                        }
                        else {
                            this[key] = configPayload[key];
                        }
                    }
                }
            }

            // Finalize: ensure plugin cache directory is ordered last in plugin
            // directories list.
            this.pluginDirectories.push(this.pluginCacheDir);

            // Finalize: ensure storage file is absolute path.
            if (!path.isAbsolute(this.storageFile)) {
                this.storageFile = make_path(this.storageFile);
            }

            donefn(this);
        })
    }
}

/**
 * The singleton system configuration instance.
 *
 * @type {module:sysconfig~Sysconfig}
 */
module.exports = new Sysconfig();

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
const BASEDIR = path.join(HOMEDIR,'.webdeploy');
const USER_CONFIG_FILE = path.join(BASEDIR,'webdeployrc');
const USER_PLUGIN_DIR = path.join(BASEDIR,'plugin-cache');
const USER_STORAGE_FILE = path.join(BASEDIR,'storage.db');

const DEFAULTS = {
    pluginDirectories: [],
    pluginCacheDir: USER_PLUGIN_DIR,
    webRepos: [],
    npmRepos: [],
    storageFile: USER_STORAGE_FILE
}

// Make sure the default user plugin directory exists. (This also indirectly
// makes sure the base directory exists.)
mkdirParents(USER_PLUGIN_DIR,HOMEDIR);

/**
 * Represents the system configuration parameters.
 */
class Sysconfig {
    /**
     * Creates a new Sysconfig instance.
     */
    constructor() {
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
        const fileName = path.join(os.homedir(),USER_CONFIG_FILE);

        fs.readFile(fileName, (err,data) => {
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
                this.storageFile = path.join(BASEDIR,this.storageFile);
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

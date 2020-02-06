/**
 * sysconfig.js
 *
 * @module sysconfig
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { mkdirParents } = require("./utils");

const BASEDIR = '.webdeploy';
const USER_CONFIG_FILE = path.join(BASEDIR,'webdeployrc');
const USER_PLUGIN_DIR = path.join(BASEDIR,'plugin-cache');

const DEFAULTS = {
    pluginDirectories: [],
    pluginCacheDir: "",
    webRepos: [],
    npmRepos: []
}

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

        // Create default plugin directories.
        var defaultPluginDir = path.resolve(path.join(__dirname,"../plugins"));
        this.pluginDirectories.push(defaultPluginDir);

        // Create default plugin cache directory path.
        var homedir = os.homedir();
        var userPluginDir = path.join(homedir,USER_PLUGIN_DIR);
        this.pluginCacheDir = userPluginDir;

        // Make sure the default user plugin directory exists. (This also makes
        // sure the base directory exists.)
        mkdirParents(path.relative(homedir,userPluginDir),homedir);
    }

    /**
     * Loads the system webdeploy configuration from disk. This optional
     * configuration is stored in a file in the user's home directory.
     *
     * @param {} donefn
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

            this.pluginDirectories.push(this.pluginCacheDir);
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

/**
 * sysconf.js
 *
 * @module sysconf
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

var configLoaded = false;
const config = {};

/**
 * Performs some initial setup on the system configuration state.
 *
 * @return {Promise<object>}
 *
 * @ignore
 */
function setupSystemConfig() {
    Object.assign(config,DEFAULTS);

    var defaultPluginDir = path.resolve(path.join(__dirname,"../plugins"));
    config.pluginDirectories.push(defaultPluginDir);

    var homedir = os.homedir();
    var userPluginDir = path.join(homedir,USER_PLUGIN_DIR);
    config.pluginCacheDir = userPluginDir;

    mkdirParents(path.relative(homedir,userPluginDir),homedir);

    return Promise.resolve(config);
}

/**
 * Loads the system webdeploy configuration from disk. This optional
 * configuration is stored in a file in the user's home directory.
 *
 * @return {Promise<object>}
 *  The promise resolves once the configuration has been loaded.
 *
 * @ignore
 */
function loadSystemConfig() {
    const fileName = path.join(os.homedir(),USER_CONFIG_FILE);

    return new Promise((resolve,reject) => {
        fs.readFile(fileName, (err,data) => {
            if (err) {
                if (err.code != 'ENOENT') {
                    reject(err);
                    return;
                }
            }
            else {
                try {
                    var configPayload = JSON.parse(data);
                } catch (error) {
                    reject(error);
                    return;
                }

                // Merge file-based configuration into the global config.

                for (var key in config) {
                    if (key in configPayload) {
                        if (Array.isArray(config[key])) {
                            config[key] = config[key].concat(configPayload[key]);
                        }
                        else {
                            config[key] = configPayload[key];
                        }
                    }
                }
            }

            resolve(config);
        })
    })
}

/**
 * Performs final work on the system config object after loading.
 *
 * @ignore
 */
function finalizeSystemConfig() {
    config.pluginDirectories.push(config.pluginCacheDir);
}

module.exports = {
    /**
     * The loaded system config object. Since the system config is loaded at
     * bootstrap time, this object is almost always guarenteed to be loaded.
     *
     * @type {object}
     */
    config,

    /**
     * Ensures that the system config is loaded.
     *
     * @return {Promise<object>}
     *  Returns a Promise that resolves to the loaded system config object.
     */
    load() {
        if (configLoaded) {
            return Promise.resolve(config);
        }

        return setupSystemConfig().then((config) => {
            return loadSystemConfig();
        }).then((config) => {
            finalizeSystemConfig();

            configLoaded = true;
            return config;
        })
    }
}

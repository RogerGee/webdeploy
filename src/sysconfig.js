// sysconf.js

const fs = require("fs");
const os = require("os");
const path = require("path");

const { mkdirParents } = require("./utils");

const BASEDIR = '.webdeploy';
const USER_CONFIG_FILE = path.join(BASEDIR,'webdeployrc');
const USER_PLUGIN_DIR = path.join(BASEDIR,'plugin-cache');

const DEFAULTS = {
    pluginDirectories: []
}

var configLoaded = false;
const config = {};

/**
 * Performs some initial setup on the system configuration state.
 *
 * @return Promise
 */
function setupSystemConfig() {
    Object.assign(config,DEFAULTS);

    var defaultPluginDir = path.resolve(path.join(__dirname,"../plugins"));
    config.pluginDirectories.push(defaultPluginDir);

    var homedir = os.homedir();
    var userPluginDir = path.join(homedir,USER_PLUGIN_DIR);
    config.pluginDirectories.push(userPluginDir);

    mkdirParents(path.relative(homedir,userPluginDir),homedir);

    return Promise.resolve(config);
}

/**
 * Loads the system webdeploy configuration from disk. This optional
 * configuration is stored in a file in the user's home directory.
 *
 * @return Promise
 *  The promise resolves once the configuration has been loaded.
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

                Object.assign(config,configPayload);
            }

            resolve(config);
        })
    })
}

module.exports = {
    config,

    load() {
        if (configLoaded) {
            return Promise.resolve(config);
        }

        return loadSystemConfig().then((config) => {
            return setupSystemConfig();
        }).then((config) => {
            configLoaded = true;
            return config;
        })
    }
}

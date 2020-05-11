/**
 * index.js
 *
 * @module plugin
 */

const fs = require("fs");
const pathModule = require("path");
const { format } = require("util");

const sysconfig = require("../sysconfig");
const { mkdirParents } = require("../utils");
const { WebdeployError } = require("../error");

/**
 * Enumerates the various plugins kinds defined in webdeploy.
 */
const PLUGIN_KINDS = {
    /**
     * A build plugin is used to translate a single target from one state to
     * another in a build.
     */
    BUILD_PLUGIN: 0,

    /**
     * A deploy plugin is used to translate one or more targets from one state
     * to another during a deploy.
     */
    DEPLOY_PLUGIN: 1
}

/**
 * Creates a fully-qualified plugin ID.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 *
 * @return {string}
 */
function makeFullPluginId(pluginInfo) {
    var { pluginId, pluginVersion } = pluginInfo;

    if (pluginVersion && pluginVersion != "latest") {
        pluginId += "@" + pluginVersion;
    }

    return pluginId;
}

/**
 * Converts a fully-qualified plugin ID into a plugin descriptor.
 *
 * @param {string} pluginIdString
 *
 * @return {object}
 */
function parseFullPluginId(pluginIdString) {
    var parts = pluginIdString.split('@');

    if (parts.length == 1) {
        return {
            pluginId: parts[0],
            pluginVersion: 'latest'
        }
    }

    if (parts.length != 2) {
        throw new WebdeployError(format("Invalid plugin '%s'",pluginIdString));
    }

    return {
        pluginId: parts[0],
        pluginVersion: parts[1]
    }
}

function requirePlugin(pluginInfo,kind) {
    // There is nothing special about a plugin - it's just a NodeJS module that
    // we "require" like any other. Plugins are loaded from plugin directories
    // configured in the system configuration.

    const PLUGIN_DIRS = sysconfig.pluginDirectories;
    const pluginId = makeFullPluginId(pluginInfo);

    var firstErr = null;
    for (let i = 0;i < PLUGIN_DIRS.length;++i) {
        let next = PLUGIN_DIRS[i];

        try {
            var plugin = require(pathModule.join(next,pluginId));
            break;
        } catch (err) {
            if (!firstErr) {
                firstErr = err;
            }

            continue;
        }
    }

    if (!plugin) {
        throw new WebdeployError("Cannot load plugin '" + pluginId + "': " + firstErr.toString());
    }

    // Make sure the plugin module exports the correct interface (i.e. it has an
    // exec() function or employs the dual-plugin interface).
    if (typeof plugin.exec != "function") {
        if (!plugin.build && kind == PLUGIN_KINDS.BUILD_PLUGIN
            || !plugin.deploy && kind == PLUGIN_KINDS.DEPLOY_PLUGIN)
        {
            throw new WebdeployError("Plugin '" + pluginId + "' does not provide required interface.");
        }

        if (kind == PLUGIN_KINDS.BUILD_PLUGIN) {
            plugin = plugin.build;
        }
        else if (kind == PLUGIN_KINDS.DEPLOY_PLUGIN) {
            plugin = plugin.deploy;
        }
        else {
            throw new Error("Plugin kind in not specified or incorrect");
        }
    }

    // Augment/overwrite the plugin object with its fully-qualified ID.
    plugin.id = pluginId;

    return plugin;
}

const DEFAULT_BUILD_PLUGINS = {
    pass: {
        id: "pass",
        exec: (target) => {
            return new Promise((resolve,reject) => {
                resolve(target.pass());
            })
        }
    }
}

const DEFAULT_DEPLOY_PLUGINS = {
    exclude: {
        id: "exclude",
        exec: (context,settings) => {
            return new Promise((resolve,reject) => {
                resolve();
            })
        }
    },

    write: {
        id: "write",
        exec: (context,settings) => {
            // Remove extraneous files first (if possible); then deploy all the
            // output targets to the deploy path.

            var promises = [];

            let removefn = function(path,isTree) {
                fullPath = context.makeDeployPath(path);
                promises.push(new Promise((resolve,reject) => {
                    if (isTree) {
                        fs.rmdir(fullPath, (err) => {
                            if (err) {
                                if (err.code == 'ENOENT') {
                                    resolve();
                                }
                                else {
                                    reject(err);
                                }
                            }
                            else {
                                context.logger.log("Removed _" + path  + "_");
                                resolve();
                            }
                        })
                    }
                    else {
                        fs.unlink(fullPath, (err) => {
                            if (err) {
                                if (err.code == 'ENOENT') {
                                    resolve();
                                }
                                else {
                                    reject(err);
                                }
                            }
                            else {
                                context.logger.log("Removed _" + path + "_");
                                resolve();
                            }
                        })
                    }
                }))
            }

            return context.tree.walkExtraneous(removefn).then(() => {
                return Promise.all(promises);

            }).then(() => {
                if (typeof settings.mode == "undefined") {
                    settings.mode = 0o666;
                }
                else {
                    // Force Number to convert possible string values. This works
                    // for octal literals encoded as strings.
                    settings.mode = Number(settings.mode);
                }

                return new Promise((resolve,reject) => {
                    var pathset = new Set();

                    // Make sure deploy path exists.
                    mkdirParents(context.deployPath);

                    for (var i = 0;i < context.targets.length;++i) {
                        var target = context.targets[i];

                        // Ensure parent directory exists.
                        if (!pathset.has(target.sourcePath)) {
                            pathset.add(target.sourcePath);
                            mkdirParents(target.sourcePath,context.deployPath);
                        }

                        // Write data to file.
                        var outPath = target.getDeployTargetPath();
                        var outStream = fs.createWriteStream(outPath,{ mode: settings.mode });
                        target.stream.pipe(outStream);
                        context.logger.log("Writing _" + outPath + "_");
                    }

                    resolve();
                })
            })
        }
    }
}

function lookupDefaultPlugin(pluginInfo,kind) {
    if (kind == PLUGIN_KINDS.BUILD_PLUGIN) {
        var database = DEFAULT_BUILD_PLUGINS;
    }
    else if (kind == PLUGIN_KINDS.DEPLOY_PLUGIN) {
        var database = DEFAULT_DEPLOY_PLUGINS;
    }
    else {
        return;
    }

    if (pluginInfo.pluginId in database) {
        if (pluginInfo.pluginVersion && pluginInfo.pluginVersion != "latest") {
            // TODO Warn about default plugin not having latest version.

        }

        return database[pluginInfo.pluginId];
    }
}

/**
 * Determines if the plugin is a default plugin.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 *
 * @return {boolean}
 */
function isDefaultPlugin(pluginInfo) {
    if (pluginInfo.pluginId in DEFAULT_BUILD_PLUGINS
        || pluginInfo.pluginId in DEFAULT_DEPLOY_PLUGINS)
    {
        return true;
    }

    return false;
}

/**
 * Loads a plugin by kind.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 * @param {number} kind
 *  One of the PLUGIN_KIND constants.
 *
 * @return {object}
 */
function loadPluginByKind(pluginInfo,kind) {
    var plugin = lookupDefaultPlugin(pluginInfo,kind);
    if (!plugin) {
        plugin = requirePlugin(pluginInfo,kind);
    }

    return plugin;
}

/**
 * Looks up a default build plugin.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 *
 * @return {object}
 */
function lookupDefaultBuildPlugin(pluginInfo) {
    return lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.BUILD_PLUGIN);
}

/**
 * Looks up a default deploy plugin.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 *
 * @return {object}
 */
function lookupDefaultDeployPlugin(pluginInfo) {
    return lookupDefaultPlugin(pluginInfo,PLUGIN_KINDS.DEPLOY_PLUGIN);
}

module.exports = {
    PLUGIN_KINDS,

    isDefaultPlugin,
    loadPluginByKind,
    lookupDefaultBuildPlugin,
    lookupDefaultDeployPlugin,

    makeFullPluginId,
    parseFullPluginId
}

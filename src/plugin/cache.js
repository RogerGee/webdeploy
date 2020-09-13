/**
 * cache.js
 *
 * @module plugin/cache
 */

const fs = require("fs");
const path = require("path");
const { format } = require("util");
const http = require("http");
const https = require("https");
const urlparse = require("url").parse;
const child_process = require("child_process");
const tar = require("tar");

const sysconfig = require("../sysconfig");
const { NPMPackageInstaller, HTTPPackageInstaller } = require("../package");
const { WebdeployError } = require("../error");

const PLUGIN_DIRECTORY_EXISTS = 100;

function makePlugin(pluginInfo) {
    // Preserve existing augmented plugin object.
    if (path in pluginInfo) {
        return pluginInfo;
    }

    // Augment plugin object for use within this module.

    var fullName = format("%s@%s",pluginInfo.pluginId,pluginInfo.pluginVersion);

    return {
        id: pluginInfo.pluginId,
        version: pluginInfo.pluginVersion,
        installPath: sysconfig.pluginCacheDir,
        packageDir: fullName
    }
}

function makeRepo(type) {
    return (options) => {
        return {
            options,
            type
        }
    }
}

function installPluginFromRepos(plugin,repos,logger,donefn,errfn,index) {
    index = index || 0;

    if (index >= repos.length) {
        errfn(new WebdeployError(
            format("Couldn't find plugin package for '%s@%s' in any repository",
                   plugin.id,plugin.version)));
        return;
    }

    var repo = repos[index];
    var continuefn = function() {
        installPluginFromRepos(plugin,repos,logger,donefn,errfn,index+1);
    }

    if (!repo.options.repoURL) {
        throw new WebdeployError(
            format("No 'repoURL' was configured in repository of type '%s'",
                   repo.type));
    }

    if (repo.type == 'web') {
        installPluginFromWebRepo(plugin,repo.options,donefn,continuefn,errfn,logger);
    }
    else if (repo.type == 'npm') {
        installPluginFromNPMRepo(plugin,repo.options,donefn,continuefn,errfn,logger);
    }
    else {
        errfn(new WebdeployError(format("Repo having type '%s' at '%s' is not supported",
                               repo.type,repo.options.repoURL)));
    }
}

function installPluginFromWebRepo(plugin,options,donefn,continuefn,errfn,logger) {
    var installer = new HTTPPackageInstaller({
        installPath: plugin.installPath,
        packageDir: plugin.packageDir,
        baseURLs: [options.repoURL],
        logger
    });

    installer.installPackage(plugin.id,plugin.version,donefn,continuefn,errfn);
}

function installPluginFromNPMRepo(plugin,options,donefn,continuefn,errfn,logger) {
    var installer = new NPMPackageInstaller({
        installPath: plugin.installPath,
        packageDir: plugin.packageDir,
        npmRegistries: [options.repoURL],
        logger
    });

    // Prepare package name using configured options.
    var packageName = "";
    if (options.namespace) {
        // NOTE: The user must include the '@' in the namespace specifier.
        packageName += options.namespace.replace(/\/$/,'') + "/";
    }
    if (options.prefix) {
        packageName += options.prefix;
    }
    packageName += plugin.id;

    installer.installPackage(packageName,plugin.version,donefn,continuefn,errfn);
}

/**
 * Loads a plugin if it is available in the plugin cache.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 *
 * @return {object}
 *  Returns the loaded plugin object.
 */
function loadPlugin(pluginInfo) {
    var plugin = makePlugin(pluginInfo);

    try {
        return require(plugin.path);
    } catch (err) { }

    return false;
}

/**
 * Installs a plugin directly without checking if it already exists.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 * @param {function} donefn
 * @param {function} errfn
 * @param {module:logger=} logger
 *  If provided, then the installation process will be logged.
 */
function installPluginDirect(pluginInfo,donefn,errfn,logger) {
    var plugin = makePlugin(pluginInfo);
    var repos = sysconfig.npmRepos.map(makeRepo('npm'))
        .concat(sysconfig.webRepos.map(makeRepo('web')));

    if (repos.length == 0) {
        errfn(new WebdeployError("No package repositories are configured"));
        return;
    }

    if (logger) {
        logger.log(
            format(
                "Installing plugin _%s@%s_ from repositories",
                plugin.id,
                plugin.version
            )
        );
        logger.pushIndent();
    }

    function localdone(...args) {
        if (logger) {
            logger.popIndent();
        }
        donefn(...args);
    }

    installPluginFromRepos(plugin,repos,logger,localdone,errfn);
}

/**
 * Installs a plugin but first checks to see if it already exists.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 * @param {function} donefn
 * @param {function} errfn
 * @param {module:logger=} logger
 *  If provided, then the installation process will be logged.
 */
function installPlugin(pluginInfo,donefn,errfn,logger) {
    var plugin = makePlugin(pluginInfo);

    fs.stat(plugin.path, (err,stats) => {
        if (!err) {
            if (stats.isDirectory()) {
                errfn(new WebdeployError("Plugin is already installed",
                                         PLUGIN_DIRECTORY_EXISTS));
            }
            else {
                errfn(new WebdeployError("Entry in filesystem is not a directory for plugin"));
            }

            return;
        }

        if (logger) {
            logger.log(
                format(
                    "Installing plugin _%s@%s_ from repositories",
                    plugin.id,
                    plugin.version
                )
            );
            logger.pushIndent();
        }

        function localdone(...args) {
            if (logger) {
                logger.popIndent();
            }
            donefn(...args);
        }

        installPluginDirect(plugin,localdone,errfn,logger);
    });
}

/**
 * Ensures that a plugin is installed.
 *
 * @param {object} pluginInfo
 *  Plugin descriptor representing plugin to load.
 * @param {string} pluginInfo.pluginId
 * @param {string} pluginInfo.pluginVersion
 * @param {function} donefn
 *  Callback when operation completes successfully; the function is passed a
 *  boolean denoting whether the plugin had to be installed.
 * @param {function} errfn
 * @param {module:logger=} logger
 *  If provided, then the installation process will be logged.
 */
function ensurePlugin(pluginInfo,donefn,errfn,logger) {
    // Attempt to install the plugin and succeed if the plugin already exists.
    installPlugin(pluginInfo,function() {
        donefn(true);

    },function(err) {
        if (err instanceof WebdeployError && err.code == PLUGIN_DIRECTORY_EXISTS) {
            donefn(false);
        }
        else {
            errfn(err);
        }

    }, logger)
}

module.exports = {
    loadPlugin,
    installPluginDirect,
    installPlugin,
    ensurePlugin
}

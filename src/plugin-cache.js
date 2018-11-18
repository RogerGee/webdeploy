// plugin-cache.js

const fs = require("fs");
const path = require("path");
const { format } = require("util");
const http = require("http");
const https = require("https");
const urlparse = require("url").parse;

const tar = require("tar");

const sysconfig = require("./sysconfig").config;
const { WebdeployError } = require("./error");

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
        fullName,
        path: path.join(sysconfig.pluginCacheDir,fullName)
    }
}

function makeRepo(type) {
    return (repo) => {
        return {
            path: repo,
            type
        }
    }
}

function installPluginFromRepos(plugin,repos,donefn,errfn,index) {
    index = index || 0;

    if (index >= repos.length) {
        errfn(new WebdeployError("Couldn't find plugin package in any repository"));
        return;
    }

    var repo = repos[index];
    var continuefn = function(plugin) {
        installPluginFromRepos(plugin,repos,donefn,errfn,index+1);
    }

    if (repo.type == 'web') {
        installPluginFromWebRepo(plugin,repo.path,donefn,continuefn,errfn);
    }
    else {
        errfn(new WebdeployError(format("Repo having type '%s' at '%s' is not supported",
                               repo.type,repo.path)));
    }
}

function installPluginFromWebRepo(plugin,baseURL,donefn,continuefn,errfn) {
    var url = format("%s/%s/%s@%s.tar.gz",
                     baseURL,
                     plugin.id,
                     plugin.id,
                     plugin.version);

    var req = url.substring(0,5) == "https" ? https : http;

    req.get(url, (res) => {
        const { statusCode } = res;
        const contentType = res.headers['content-type'];

        if (statusCode != 200) {
            if (statusCode == 404) {
                continuefn(plugin);
            }
            else {
                errfn(new WebdeployError(format("Failed request to '%s'",url)));
            }

            return;
        }

        if (!/application\/x-gzip/.test(contentType)) {
            errfn(new WebdeployError(format("Server returned invalid package response")));
            return;
        }

        fs.mkdir(plugin.path, (err) => {
            if (err && err.code != 'EEXIST') {
                errfn(err);
                return;
            }

            var tarstream = tar.x({
                cwd: plugin.path,
                onerror(err) {
                    console.log(err);
                }
            })

            tarstream.on('warn',errfn);
            tarstream.on('err',errfn);
            tarstream.on('end',donefn);

            res.pipe(tarstream);
        })
    })
}

/**
 * Loads a plugin if it is available in the plugin cache.
 *
 * @param string pluginInfo.pluginId
 * @param string pluginInfo.pluginVersion
 *
 * @return mixed
 */
function loadPlugin(pluginInfo) {
    var plugin = makePlugin(pluginInfo);

    try {
        return require(plugin.path);
    } catch (err) { }

    return false;
}

function installPluginDirect(pluginInfo,donefn,errfn) {
    var plugin = makePlugin(pluginInfo);
    var repos = sysconfig.npmNamespaces.map(makeRepo('npm'))
        .concat(sysconfig.webRepos.map(makeRepo('web')));

    if (repos.length == 0) {
        errfn(new WebdeployError("No package repositories are configured"));
        return;
    }

    installPluginFromRepos(plugin,repos,donefn,errfn);
}

function installPlugin(pluginInfo,donefn,errfn) {
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

        installPluginDirect(plugin,donefn,errfn);
    })
}

function ensurePlugin(pluginInfo,donefn,errfn) {
    // Attempt to install the plugin and succeed if the plugin already exists.
    installPlugin(pluginInfo,donefn,(err) => {
        if (err instanceof WebdeployError && err.code == PLUGIN_DIRECTORY_EXISTS) {
            donefn();
        }
        else {
            errfn(err);
        }
    })
}

module.exports = {
    loadPlugin,
    installPluginDirect,
    installPlugin,
    ensurePlugin
}

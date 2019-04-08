// plugin-cache.js

const fs = require("fs");
const path = require("path");
const { format } = require("util");
const http = require("http");
const https = require("https");
const urlparse = require("url").parse;
const child_process = require("child_process");

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
    var continuefn = function(plugin) {
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

function installPluginOverHttp(plugin,url,logger,donefn,continuefn,errfn,extractOptions) {
    var req = url.substring(0,5) == "https" ? https : http;
    extractOptions = extractOptions || {};

    if (logger) {
        logger.log(format("Downloading %s...",url));
    }

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

        if (!/application\/x-gzip/.test(contentType) && !/application\/octet-stream/.test(contentType)) {
            errfn(new WebdeployError(
                format("Server returned invalid package response type: '%s'",
                       contentType)));
            return;
        }

        if (logger) {
            logger.log(format("Extracting archive..."));
        }

        fs.mkdir(plugin.path, (err) => {
            if (err && err.code != 'EEXIST') {
                errfn(err);
                return;
            }

            var tarstream = tar.x(Object.assign(extractOptions, {
                cwd: plugin.path,
                onerror(err) {
                    console.log(err);
                }
            }))

            tarstream.on('warn',errfn);
            tarstream.on('err',errfn);
            tarstream.on('end',() => {
                if (logger) {
                    logger.log(format("Executing 'npm install' on extracted plugin"));
                }

                runNpmOnPlugin(plugin,donefn,errfn);
            })

            res.pipe(tarstream);
        })
    })
}

function installPluginFromWebRepo(plugin,options,donefn,continuefn,errfn,logger) {
    var url = format("%s/%s/%s@%s.tar.gz",
                     options.repoURL.replace(/\/$/,''),
                     plugin.id,
                     plugin.id,
                     plugin.version);

    if (logger) {
        logger.pushIndent();
    }

    installPluginOverHttp(plugin,url,logger,donefn,continuefn,errfn);

    if (logger) {
        logger.popIndent();
    }
}

function installPluginFromNPMRepo(plugin,options,donefn,continuefn,errfn,logger) {
    var prefix = "";

    if (options.namespace) {
        // NOTE: The user must include the '@' in the namespace specifier.
        prefix += options.namespace + "%2f";
    }
    if (options.prefix) {
        prefix += options.prefix;
    }

    var url = format("%s/%s%s/-/%s%s-%s.tgz",
                     options.repoURL.replace(/\/$/,''),
                     prefix,
                     plugin.id,
                     options.prefix,
                     plugin.id,
                     plugin.version);

    function localdonefn() {
        var path = path.join(plugin.path,"package");

    }

    installPluginOverHttp(plugin,url,logger,donefn,continuefn,errfn, {
        strip: 1
    })
}

function runNpmOnPlugin(plugin,donefn,errfn) {
    if (process.platform == 'win32') {
        var command = 'npm.cmd';
    }
    else {
        var command = 'npm';
    }

    var proc = child_process.spawn(command,["install"], {
        cwd: plugin.path,
        stdio: 'inherit'
    })

    proc.on('exit', (code,signal) => {
        if (signal) {
            errfn(new WebdeployError(
                format("The 'npm' subprocess exited with signal '%s'",
                       signal)));
        }
        else if (code != 0) {
            errfn(new WebdeployError(
                format("The 'npm' subprocess exited non-zero")));
        }
        else {
            donefn();
        }
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

function installPluginDirect(pluginInfo,donefn,errfn,logger) {
    var plugin = makePlugin(pluginInfo);
    var repos = sysconfig.npmRepos.map(makeRepo('npm'))
        .concat(sysconfig.webRepos.map(makeRepo('web')));

    if (repos.length == 0) {
        errfn(new WebdeployError("No package repositories are configured"));
        return;
    }

    if (logger) {
        logger.log(format("Installing plugin _%s@%s_ from repositories",
                          plugin.id,plugin.version));
    }

    installPluginFromRepos(plugin,repos,logger,donefn,errfn);
}

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

        installPluginDirect(plugin,donefn,errfn,logger);
    })
}

function ensurePlugin(pluginInfo,donefn,errfn,logger) {
    // Attempt to install the plugin and succeed if the plugin already exists.
    installPlugin(pluginInfo,donefn,(err) => {
        if (err instanceof WebdeployError && err.code == PLUGIN_DIRECTORY_EXISTS) {
            donefn();
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

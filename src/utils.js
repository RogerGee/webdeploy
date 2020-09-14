/**
 * utils.js
 *
 * @module utils
 */

const fs = require("fs");
const pathModule = require("path");
const child_process = require("child_process");

function getPathParents(path,base) {
    var parsed = pathModule.parse(path);

    if (!base) {
        path = parsed.root;
    }
    else {
        // Assume base exists.
        path = base;
    }

    if (parsed.dir.substr(0,path.length) == path) {
        parsed.dir = parsed.dir.substr(path.length);
    }

    var parts = pathModule.join(parsed.dir,parsed.base)
        .split(pathModule.sep)
        .filter((x) => {
            return Boolean(x);
        });

    return { path, parts };
}

/**
 * Creates a directory and any parents that do not exist.
 *
 * @param {string} path
 *  The path to create.
 * @param {string} base
 *  Base path denoting the existing base. May be null. This merely optimizes the
 *  operation since the function assumes the base path already exists.
 *
 * @return {Promise<number>}
 *  Resolves to the number of directories created.
 */
module.exports.mkdirParents = async function(path,base) {
    var n = 0;
    var { parts, path } = getPathParents(path,base);

    for (let i = 0;i < parts.length;++i) {
        path = pathModule.join(path,parts[i]);

        var err = await new Promise((resolve,reject) => {
            fs.mkdir(path,resolve);
        });
        if (err && err.code != 'EEXIST') {
            throw err;
        }
        if (!err) {
            n += 1;
        }
    }

    return n;
};

/**
 * Creates a directory and any parents that do not exist.
 *
 * @param {string} path
 *  The path to create.
 * @param {string} [base]
 *  Base path denoting the existing base. This merely optimizes the operation
 *  since the function assumes the base path already exists.
 */
module.exports.mkdirParentsSync = function(path,base) {
    var { parts, path } = getPathParents(path,base);

    for (var i = 0;i < parts.length;++i) {
        path = pathModule.join(path,parts[i]);

        try {
            fs.mkdirSync(path);
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err;
            }
        }
    }
};

/**
 * Removes a single branch in a directory tree up until an indicated base
 * directory OR up until the first non-empty directory.
 *
 * @param {string} base
 *  The base directory at which point the operation stops.
 * @param {string} path
 *  The directory to remove. All its parent directories are removed as well up
 *  until the base directory.
 *
 * @return {Promise<number>}
 *  Resolves to the number of directories removed.
 */
module.exports.rmdirParents = async function(parent,path) {
    var rm = [];
    var currentPath = path;

    while (currentPath.substring(0,parent.length) == parent) {
        if (currentPath == parent) {
            break;
        }

        rm.push(currentPath);
        currentPath = pathModule.parse(currentPath).dir;
    }

    for (let i = 0;i < rm.length;++i) {
        var err = await new Promise((resolve,reject) => {
            fs.rmdir(rm[i],resolve);
        });
        if (err) {
            if (err.code == 'ENOTEMPTY') {
                break;
            }
            throw err;
        }
    }

    return rm.length;
};

/**
 * Prepares a path as a git-config key.
 *
 * @param {string} path
 *  The path to create.
 *
 * @return {string}
 *  The prepared path.
 */
module.exports.prepareConfigPath = function(path) {
    var result = path.replace(/\/|\\/g,'--').replace(/\./g,'-');
    if (result[0] == '-') {
        result = "PATH" + result;
    }

    return result;
};

/**
 * Mangles a file path to a single value that can be used as a file system entry
 * name.
 *
 * @param {string} filePath
 *
 * @return {string}
 */
module.exports.flattenPath = function(filePath) {
    let result = filePath;
    result = result.replace(/[\/\\]+$/,'');
    return result.replace(/\/|\\/g,'--');
};

/**
 * Executes NPM.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @param {boolean} hasStdout
 * @param {function} donefn
 * @param {function} errfn
 *
 * @returns {stream.Readable}
 */
module.exports.runNPM = function(args,cwd,hasStdout,callback) {
    const command = process.platform == 'win32' ? 'npm.cmd' : 'npm';

    const stdio = ['ignore','ignore','inherit'];
    if (hasStdout) {
        stdio[1] = 'pipe';
    }

    const proc = child_process.spawn(command,args,{
        cwd,
        stdio
    });

    proc.on('exit', (code,signal) => {
        if (signal) {
            callback(new WebdeployError("The 'npm' subprocess exited with signal '%s'",signal));
        }
        else if (code != 0) {
            callback(new WebdeployError("The 'npm' subprocess exited non-zero"));
        }
        else {
            callback();
        }
    });

    return proc.stdout;
};

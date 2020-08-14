/**
 * utils.js
 *
 * @module utils
 */

const fs = require("fs");
const pathModule = require("path");

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
 * @param {function} donefn
 *  Called when the operation completes. Receives an error if one occurred.
 */
module.exports.mkdirParents = function(path,base,donefn) {
    var { parts, path } = getPathParents(path,base);

    async function mkdirParents() {
        for (let i = 0;i < parts.length;++i) {
            path = pathModule.join(path,parts[i]);

            var err = await new Promise((resolve,reject) => {
                fs.mkdir(path,resolve);
            });
            if (err && err.code != 'EEXIST') {
                throw err;
            }
        }
    }

    mkdirParents().then(donefn,donefn);
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
 * directory.
 *
 * @param {string} base
 *  The base directory at which point the operation stops.
 * @param {string} path
 *  The directory to remove. All its parent directories are removed as well up
 *  until the base directory.
 * @param {function} donefn
 *  Called when the operation completes. Receives an error if one occurred.
 */
module.exports.rmdirParents = function(parent,path,donefn) {
    var rm = [];
    var currentPath = path;

    while (currentPath.substring(0,parent.length) == parent) {
        if (currentPath == parent) {
            break;
        }

        rm.push(currentPath);
        currentPath = pathModule.parse(currentPath).dir;
    }

    async function rmdirParents() {
        for (let i = 0;i < rm.length;++i) {
            var err = await new Promise((resolve,reject) => {
                fs.rmdir(rm[i],resolve);
            });
            if (err) {
                throw err;
            }
        }
    }

    rmdirParents().then(donefn,donefn);
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

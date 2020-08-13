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
 *  Optional base path denoting the existing base. This merely optimizes the
 *  operation since the function assumes the base path already exists.
 * @param {function} donefn
 */
module.exports.mkdirParents = function(path,base,donefn) {
    var { parts, path } = getPathParents(path,base);

    var index = 0;
    function nextfn(err) {
        if (err) {
            donefn(err);
            return;
        }

        if (index >= parts.length) {
            donefn();
            return;
        }

        path = pathModule.join(path,parts[index++]);
        fs.mkdir(path,nextfn);
    }

    nextfn();
};

/**
 * Creates a directory and any parents that do not exist.
 *
 * @param {string} path
 *  The path to create.
 * @param {string} base
 *  Optional base path denoting the existing base. This merely optimizes the
 *  operation since the function assumes the base path already exists.
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

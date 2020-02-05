/**
 * tree.js
 *
 * @module tree
 */

const fs = require("fs");
const git = require("nodegit");

const RepoTree = require("./repo-tree");
const PathTree = require("./path-tree");

/**
 * Creates a new RepoTree for the specified repository.
 *
 * @param {string} repoPath
 *  The path where the repository lives.
 * @param {object} options
 *  Extra options for the RepoTree.
 *
 * @return {Promise<module:tree/repo-tree~RepoTree>}
 */
function createRepoTree(repoPath,options) {
    return git.Repository.discover(repoPath,0,"").then((path) => {
        return git.Repository.open(path);

    }).then((repository) => {
        return new RepoTree(repository,options);
    })
}

/**
 * Creates a new PathTree for the specified path in the filesystem.
 *
 * @param {string} path
 *  The path to load.
 * @param {object} options
 *  Extra options for the PathTree.
 *
 * @return {Promise<module:tree/path-tree~PathTree>}
 */
function createPathTree(path,options) {
    return new Promise((resolve,reject) => {
        fs.stat(path,(err,stats) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(new PathTree(path,options));
        })
    })
}

module.exports = {
    createRepoTree,
    createPathTree
}

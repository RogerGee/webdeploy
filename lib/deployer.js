// deployer.js

const treeLoader = require("./tree.js");
const builder = require("./builder.js");

function deployMain(tree,options) {

}

function deployRepository(repo,dryRun) {
    treeLoader.loadFromGitRepository(repo).then((tree) => {
        deployMain(tree,{ dryRun: dryRun });
    });
}

function deployLocal(path,dryRun) {
    treeLoader.loadFromPath(path).then((tree) => {
        deployMain(tree,{ dryRun: dryRun });
    });
}

module.exports = {
    deployRepo: deployRepository,
    deployLocal: deployLocal
};

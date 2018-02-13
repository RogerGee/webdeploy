// deployer.js

const treeLoader = require("./tree.js");
const builder = require("./builder.js");

function deployMain(tree,options) {

}

function deployRepository(repo,dryRun) {
    return treeLoader.createRepoTree(repo).then((tree) => {
        deployMain(tree,{ dryRun: dryRun });
    });
}

function deployLocal(path,dryRun) {
    return treeLoader.createPathTree(path).then((tree) => {
        deployMain(tree,{ dryRun: dryRun });
    });
}

module.exports = {
    deployRepo: deployRepository,
    deployLocal: deployLocal
};

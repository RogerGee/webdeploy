/**
 * repo-tree.js
 *
 * @module tree/repo-tree
 */

const path = require("path").posix;
const git = require("nodegit");
const { format } = require("util");

const { TreeBase } = require("./");
const configuration = require("../config");
const { makeTargetStream } = require("../target");
const { prepareConfigPath } = require("../utils");
const { WebdeployError } = require("../error");

const COMMIT_KEY = "DEPLOY";
const PREV_COMMIT_KEY = "DEPLOY-PREV";

function makeBlobStream(blob) {
    // Fake a stream for the content buffer. It doesn't seem nodegit provides
    // the ODB read stream yet (and the default ODB backends don't provide
    // streaming capabilities anyways).

    var bufferStream = makeTargetStream();
    bufferStream.end(blob.content());

    return bufferStream;
}

/**
 * @typedef module:tree/repo-tree~repoTreeOptions
 * @property {string} deployBranch
 *  The branch (i.e. head reference) from which to load the deployment
 *  commit. This overrides saved deploy config.
 * @property {string} deployTag
 *  The tag (i.e. tag reference) from which to load the deployment commit. The
 *  tag is considered before the branch.
 */

/**
 * Represents a tree of potential deploy targets that are sourced from a git
 * repository using nodegit. The tree also can read configuration from the
 * repo's git-config.
 */
class RepoTree extends TreeBase {
    /**
     * Creates a new RepoTree instance.
     *
     * @param {nodegit.Repository} repo
     *  The libgit2 repository object instance to wrap.
     * @param {module:tree/repo-tree~repoTreeOptions} options
     */
    constructor(repo,options) {
        super(options);

        this.name = 'RepoTree';
        this.repo = repo;
        this.gitConfig = null;
        this.gitConfigCache = {};

        // If the repo path ends with a '.git' component, then the tree is
        // considered local and we modify the path to be (at least what is
        // conventionally) the working tree.
        this.repoPath = this.repo.path();
        const match = this.repoPath.match(/[\/\\]\.git[\/\\]*$/);
        if (match) {
            this.local = true;
            this.repoPath = this.repoPath.substring(0,this.repoPath.length-match[0].length);
        }
        else {
            this.local = false;
            this.repoPath = this.repoPath.replace(/[\/\\]+$/,"")
        }

        // Cache Promises to certain, often-accessed resources.
        this.deployCommits = {};
        this.targetTrees = {};

        this.init();
    }

    // Implements TreeBase.getPath().
    getPath() {
        return this.repoPath;
    }

    // Implements TreeBase.isLocal().
    isLocal() {
        return this.local;
    }

    // Implements TreeBase.getBlob().
    getBlob(blobPath) {
        return this.getTargetTree().then((targetTree) => {
            return this.getBlobImpl(blobPath,targetTree);
        });
    }

    // Implements TreeBase.testTree().
    async testTree(treePath) {
        const tree = await this.getTargetTree();
        try {
            const entry = await tree.getEntry(treePath);
            return entry.isTree();
        } catch (ex) {

        }

        return false;
    }

    // Implements TreeBase.testBlob().
    async testBlob(blobPath) {
        const tree = await this.getTargetTree();
        try {
            const entry = await tree.getEntry(blobPath);
            return entry.isBlob();
        } catch (ex) {

        }

        return false;
    }

    // Implements TreeBase.walk().
    async walk(callback,options) {
        if (options) {
            options = Object.assign({},options);
        }
        else {
            options = {};
        }

        let tree = await this.getTargetTree();

        // Look up subtree of target tree if base path is specified.
        if (options.basePath) {
            const entry = await tree.getEntry(options.basePath);
            if (!entry.isTree()) {
                throw new WebdeployError(
                    "Base path '%s' does not refer to a tree",
                    options.basePath
                );
            }

            tree = await entry.getTree();
        }

        options.targetTree = tree;
        await this.walkImpl(tree.path(),tree,callback,options);
    }

    // Implements TreeBase.walkExtraneous().
    walkExtraneous(callback) {
        // Walks through the previous commit and invokes the callback on each
        // entry that exists in the previous commit but not in the current
        // commit. Essentially this is called on all blobs that no longer exist.

        var currentTree;

        return this.getTargetTree().then((targetTree) => {
            currentTree = targetTree;
            return this.getPreviousCommit();

        }).then((commit) => {
            return this.getTargetTree(commit);

        }).then((tree) => {
            return this.walkExtraneousImpl(tree.path(),tree,currentTree,callback);
        });
    }

    // Implements TreeBase.isBlobModified().
    async isBlobModified(blobPath,mtime) {
        const prevCommit = await this.getPreviousCommit();
        if (!prevCommit) {
            return true;
        }

        const prevTree = await this.getTargetTree(prevCommit);
        const targetTree = await this.getTargetTree();

        let prevEntry;
        let entry;

        try {
            prevEntry = await prevTree.entryByPath(blobPath);
        } catch (ex) {
            // If the previous entry wasn't found, then report that the blob was
            // modified.
            return true;
        }

        try {
            entry = await targetTree.entryByPath(blobPath);
        } catch (ex) {
            // If the current entry doesn't exist (i.e. it was removed), then
            // report that the blob was not modified (i.e. there is no action we
            // should take on it).
            return false;
        }

        // Otherwise see if the OID changed.

        return !prevEntry.id().equal(entry.id());
    }

    // Implements TreeBase.getMTime().
    async getMTime(blobPath) {
        // A RepoTree cannot provide a modified timestamp so we always return
        // 0. The implementation of isBlobModified() will ignore this value.
        return 0
    }

    // Implements TreeBase.finalizeImpl().
    finalizeImpl() {
        if (COMMIT_KEY in this.deployCommits) {
            return this.getDeployCommit().then((commit) => {
                this.writeDeployConfig('lastRevision',commit.id().tostrS());
            });
        }

        return Promise.resolve();
    }

    ////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////

    getConfigObject() {
        if (this.gitConfig) {
            return Promise.resolve(this.gitConfig);
        }

        return this.repo.config().then((config) => {
            this.gitConfig = config;
            return config;
        });
    }

    getDeployCommit() {
        if (COMMIT_KEY in this.deployCommits) {
            return this.deployCommits[COMMIT_KEY];
        }

        // Attempt to load the deploy commit reference from the deploy
        // config. We first try a tag, then a head.

        const options = {
            'refs/tags/': 'deployTag',
            'refs/heads/': 'deployBranch'
        };

        for (var key in options) {
            var name = this.getDeployConfig(options[key]);
            if (name) {
                var ref = format("refs/heads/%s",name);

                var promise = this.repo.getReference(ref).then((reference) => {
                    return git.Commit.lookup(this.repo, reference.target());
                }).catch((err) => {
                    throw new WebdeployError("Reference '" + ref + "' did not exist in the repository");
                });

                break;
            }
        }

        if (!promise) {
            promise = Promise.reject(
                new WebdeployError("Deployment config missing 'deployBranch' or 'deployTag'")
            );
        }

        this.deployCommits[COMMIT_KEY] = promise;

        return promise;
    }

    getPreviousCommit() {
        // NOTE: The promise resolves to null if the commit was not
        // found. Rejection occurs on any other, unanticipated error.

        if (PREV_COMMIT_KEY in this.deployCommits) {
            return this.deployCommits[PREV_COMMIT_KEY];
        }

        var lastRevision = this.getDeployConfig('lastRevision');
        if (!lastRevision) {
            return Promise.resolve(null);
        }

        var promise = this.repo.getCommit(lastRevision);
        this.deployCommits[PREV_COMMIT_KEY] = promise;

        return promise;
    }

    getTree(treePath,commit) {
        function callback(commit) {
            return commit.getTree().then((tree) => {
                if (treePath == "") {
                    return tree;
                }

                return tree.getEntry(treePath).then((entry) => {
                    if (!entry.isTree()) {
                        return Promise.reject(new WebdeployError("Path does not refer to tree"));
                    }

                    return entry.getTree();
                });
            });
        }

        if (!commit) {
            // Default to current deploy commit.
            return this.getDeployCommit().then(callback);
        }

        return callback(commit);
    }

    getTargetTree(commit) {
        if (commit) {
            var commitId = commit.id().tostrS();
        }
        else {
            var commitId = 'target';
        }

        if (this.targetTrees[commitId]) {
            return this.targetTrees[commitId];
        }

        var pathToTree = '';

        // Integrate target tree deploy config.
        var targetTree = this.getDeployConfig('targetTree');
        if (targetTree) {
            pathToTree = path.join(pathToTree,targetTree);
        }

        // Integrate base path option.
        var basePathOption = this.option('basePath');
        if (basePathOption) {
            pathToTree = path.join(pathToTree,basePathOption);
        }

        var promise = this.getTree(pathToTree,commit);

        this.targetTrees[commitId] = promise;

        return promise;
    }

    getBlobImpl(blobPath,tree) {
        return tree.getEntry(blobPath).then((entry) => {
            if (!entry.isBlob()) {
                return Promise.reject(new WebdeployError("Path does not refer to a blob"));
            }

            return entry.getBlob();

        }).then(makeBlobStream);
    }

    async walkImpl(prefix,tree,callback,options) {
        const entries = tree.entries();
        const targetPath = path.relative(options.targetTree.path(),prefix);

        for (let i = 0;i < entries.length;++i) {
            let ent = entries[i];

            if (ent.isBlob()) {
                const blob = await this.repo.getBlob(ent.oid());
                await callback(
                    {
                        filePath: ent.path(),
                        targetPath,
                        targetName: ent.name()
                    },
                    () => {
                        return makeBlobStream(blob);
                    }
                );
            }
            else if (ent.isTree()) {
                const newPrefix = path.join(prefix,ent.name());
                if (!options.filter || options.filter(newPrefix)) {
                    const nextTree = await this.repo.getTree(ent.oid());
                    await this.walkImpl(newPrefix,nextTree,callback,options);
                }
            }
        }
    }

    walkExtraneousImpl(prefix,tree,curTree,callback) {
        return new Promise((resolve,reject) => {
            let entries = tree.entries();

            if (entries.length == 0) {
                resolve();
                return;
            }

            let outstanding = entries.length;
            function attemptResolution() {
                if (--outstanding <= 0) {
                    resolve();
                }
            }

            for (let i = 0;i < entries.length;++i) {
                let ent = entries[i];
                let filePath = path.join(prefix,ent.name());

                let evalfn = (curEnt) => {
                    if (ent.isBlob()) {
                        if (!curEnt) {
                            callback(filePath,false);
                        }

                        attemptResolution();
                    }
                    else if (ent.isTree()) {
                        let newPrefix = path.join(prefix,ent.name());

                        this.repo.getTree(ent.oid()).then((nextTree) => {
                            return this.walkExtraneousImpl(newPrefix,nextTree,curTree,callback);

                        }).then(() => {
                            if (!curEnt || !curEnt.isTree()) {
                                callback(filePath,true);
                            }

                            attemptResolution();

                        }).catch(reject);
                    }
                }

                curTree.getEntry(filePath).then(evalfn, (err) => {
                    evalfn(null);
                });
            }
        });
    }

    async update_1(paths) {
        const cfg = await this.getConfigObject();

        // Try to populate tree record from "webdeploy" section.
        let ent;
        try {
            ent = await cfg.getEntry("webdeploy.deployBranch");
            this.writeTreeRecord("deployBranch",ent.value());
            cfg.deleteEntry("webdeploy.deployBranch");

        } catch (ex) {

        }

        try {
            ent = await cfg.getEntry("webdeploy.deployPath");
            this.writeTreeRecord("deployPath",ent.value());
            cfg.deleteEntry("webdeploy.deployPath");

        } catch (ex) {

        }

        try {
            ent = await cfg.getEntry("webdeploy.targetTree");
            this.writeTreeRecord("targetTree",ent.value());
            cfg.deleteEntry("webdeploy.targetTree");

        } catch (ex) {

        }

        const treeRecord = this.getTreeRecord();
        const { DependencyGraph } = require("../depends");

        for (let i = 0;i < paths.length;++i) {
            const deployPath = paths[i];
            const storeKey = prepareConfigPath(deployPath);
            let deployConfig = {};
            let del = [];

            try {
                const name = format("webdeploy.cache.lastDeploy.%s",storeKey);
                ent = await cfg.getEntry(name);
                deployConfig["lastRevision"] = ent.value();
                del.push(name);

            } catch (ex) {

            }

            let depends;

            try {
                const name = format("webdeploy.cache.depends.%s",storeKey);
                ent = await cfg.getEntry(name);
                depends = new DependencyGraph(JSON.parse(ent.value()));
                del.push(name);

            } catch (ex) {

            }

            if (Object.keys(deployConfig).length > 0) {
                this.setDeployment(deployPath,treeRecord.deployBranch);

                Object.keys(deployConfig).forEach((key) => {
                    this.writeDeployConfig(key,deployConfig[key]);
                });

                this.saveDeployConfig();
            }

            if (depends) {
                this.writeStorageConfig("cache.depends",depends.getStorageRepr());
            }

            for (let j = 0;j < del.length;++j) {
                cfg.deleteEntry(del[j]);
            }
        }
    }
}

module.exports = {
    RepoTree
};

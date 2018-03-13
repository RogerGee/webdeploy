// depends.js

const fs = require("fs");
const pathModule = require("path");
const assert = require("assert");
const tree = require("./tree");

const SAVE_CONFIG_KEY = "cache.depends";
const SAVE_FILE_NAME = ".webdeploy.deps";

function loadFromFile(path) {
    var graph = new DependencyGraph();
    var saveFilePath = pathModule.join(path,SAVE_FILE_NAME);

    return new Promise((resolve,reject) => {
        fs.readFile(saveFilePath,{ encoding:'utf8' },(err,data) => {
            if (!err) {
                var parsed = JSON.parse(data);

                graph.forwardMappings = parsed.map;
                graph._calcReverseMappings();
            }

            resolve(graph);
        });
    });
}

function loadFromConfig(repoTree) {
    var graph = new DependencyGraph();

    return repoTree.getConfigParameter(SAVE_CONFIG_KEY).then((text) => {
        var parsed = JSON.parse(text);

        graph.forwardMappings = parsed.map;
        graph._calcReverseMappings();

        return graph;
    }, (err) => {
        return graph;
    });
}

function saveToFile(path,graph) {
    var saveFilePath = pathModule.join(path,SAVE_FILE_NAME);

    if (!graph.isLoaded()) {
        graph.resolve();
    }

    var text = JSON.stringify({map: graph.forwardMappings});
    var options = {
        encoding: 'utf8'
    };

    return new Promise((resolve,reject) => {
        fs.writeFile(saveFilePath,text,options,(err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}

function saveToConfig(repoTree,graph) {
    if (!graph.isLoaded()) {
        graph.resolve();
    }

    return repoTree.writeConfigParameter(SAVE_CONFIG_KEY,JSON.stringify({map: graph.forwardMappings}));
}

// These generic save/load routines detect which type of tree is passed in an
// operate accordingly. PathTree instances store dependency graphs in a file
// (i.e. SAVE_FILE_NAME) under the tree. RepoTree instances store dependency
// graphs in the git-config.

function loadFromTree(tree) {
    if (tree.name == 'PathTree') {
        return loadFromFile(tree.getPath());
    }
    if (tree.name == 'RepoTree') {
        return loadFromConfig(tree);
    }
}

function saveToTree(tree,graph) {
    if (tree.name == 'PathTree') {
        return saveToFile(tree.getPath(),graph);
    }
    if (tree.name == 'RepoTree') {
        return saveToConfig(tree,graph);
    }
}

class DependencyGraph {
    constructor() {
        this.connections = {};
    }

    // For a target node N, obtain the complete required set of nodes that are
    // dependencies of N's output nodes.
    calculateRequired(node) {
        if (!(node in this.forwardMappings)) {
            return [];
        }

        var required = new Set();
        this.forwardMappings[node].forEach((product) => {
            if (product in this.reverseMappings) {
                this.reverseMappings[product].forEach((x) => { required.add(x); });
            }
        });

        return Array.from(required);
    }

    isLoaded() {
        return Boolean(this.forwardMappings && this.reverseMappings);
    }

    getProducts() {
        assert(this.isLoaded());
        return Object.keys(this.reverseMappings);
    }

    // Promise -> Array of { product, sources }
    //
    // Determines the set of build product nodes that are out-of-date based on
    // information from the tree.
    getOutOfDateProducts(tree) {
        assert(this.isLoaded());

        var products = this.getProducts();
        var promises = [];

        products.forEach((product) => {
            var promise = tree.getMTime(product).then((mtime) => {
                var sources = this.lookupReverse(product);
                var innerPromises = [];

                // Query each source blob's modification status.
                sources.forEach((source) => {
                    innerPromises.push(tree.isBlobModified(source,mtime));
                });

                return Promise.all(innerPromises)
                    .then((modifs) => {
                        for (var i = 0;i < modifs.length;++i) {
                            if (modifs[i]) {
                                return sources;
                            }
                        }

                        return false;
                    });
            });

            promises.push(promise);
        });

        return Promise.all(promises)
            .then((results) => {
                var changes = [];

                for (var i = 0;i < results.length;++i) {
                    if (results[i]) {
                        changes.push({ product: products[i], sources: results[i] });
                    }
                }

                return changes;
            });
    }

    // Promise -> Set of string
    //
    // Determines the set of sources that can safely be ignored since they are
    // not reachable by any out-of-date build product.
    getIgnoreSources(tree) {
        assert(this.isLoaded());

        // Compute set of source nodes not reachable by the set of out-of-date
        // build products.
        var sourceSet = new Set(Object.keys(this.forwardMappings));

        return this.getOutOfDateProducts(tree)
            .then((products) => {
                for (var i = 0;i < products.length;++i) {
                    var entry = products[i];

                    for (var j = 0;j < entry.sources.length;++j) {
                        sourceSet.delete(entry.sources[j]);
                    }
                }

                return sourceSet;
            });
    }

    lookupForward(a) {
        assert(this.isLoaded());
        return this.forwardMappings[a];
    }

    lookupReverse(b) {
        assert(this.isLoaded());
        return this.reverseMappings[b];
    }

    addConnection(a,b) {
        // Collapse connections that are an identity, i.e. A -> A = A.
        if (a == b) {
            return;
        }

        if (a in this.connections) {
            this.connections[a].push(b);
        }
        else {
            this.connections[a] = [b];
        }
    }

    resolve() {
        var found = new Set();

        // Compute forward mappings.
        this.forwardMappings = {};
        Object.keys(this.connections).forEach((node) => {
            var leaves = new Set();
            var stk = this.connections[node].slice(0);

            while (stk.length > 0) {
                var next = stk.pop();

                if (next in this.connections) {
                    stk = stk.concat(this.connections[next]);
                }
                else {
                    leaves.add(next);
                }

                found.add(next);
            }

            this.forwardMappings[node] = Array.from(leaves);
        });

        // Remove all nodes in the found set to get just the top-level nodes in
        // the mappings.
        found.forEach((node) => { delete this.forwardMappings[node]; });

        this._calcReverseMappings();
    }

    reset() {
        this.connections = {};
    }

    _calcReverseMappings() {
        assert(this.forwardMappings);

        this.reverseMappings = {};
        Object.keys(this.forwardMappings).forEach((node) => {
            this.forwardMappings[node].forEach((x) => {
                if (x in this.reverseMappings) {
                    this.reverseMappings[x].push(node);
                }
                else {
                    this.reverseMappings[x] = [node];
                }
            });
        });
    }
}

module.exports = {
    loadFromTree: loadFromTree,
    saveToTree: saveToTree,

    DependencyGraph: DependencyGraph
};

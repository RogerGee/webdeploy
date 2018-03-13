// depends.js

const fs = require("fs");
const pathModule = require("path");
const assert = require("assert");

const SAVE_FILE_NAME = ".webdeploy.deps";

function loadFromFile(path) {
    var graph = new DependencyGraph();
    var saveFilePath = pathModule.join(path,SAVE_FILE_NAME);

    try {
        const json = fs.readFileSync(saveFilePath,{ encoding:'utf8' });
        var parsed = JSON.parse(json);

        graph.forwardMappings = parsed.map;
        graph._calcReverseMappings();
    } catch (e) {
        // pass
    }

    return graph;
}

function saveToFile(path,graph) {
    var saveFilePath = pathModule.join(path,SAVE_FILE_NAME);

    if (!graph.forwardMappings) {
        graph.resolve();
    }

    try {
        fs.writeFileSync(saveFilePath,JSON.stringify({map: graph.forwardMappings}));
    } catch (e) {
        // pass
    }
}

class StatCache {
    constructor(basePath) {
        this.basePath = basePath;
        this.cache = {};
    }

    // Promise -> Number || Boolean
    lookup(path) {
        if (path in this.cache) {
            return this.cache[path];
        }

        return this.cache[path] = new Promise((resolve,reject) => {
            fs.lstat(pathModule.join(this.basePath,path),(err,stats) => {
                if (err) {
                    if (err.code == 'ENOENT') {
                        resolve(false);
                    }
                    else {
                        reject(err);
                    }
                }
                else {
                    resolve(stats.mtime);
                }
            });
        });
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
    // file mtime information.
    getOutOfDateProducts(buildPath) {
        assert(this.isLoaded());

        var stats = new StatCache(buildPath);
        var products = this.getProducts();
        var promises = [];

        products.forEach((product) => {
            var sources = this.lookupReverse(product);
            var innerPromises = [stats.lookup(product)];

            // Stat each file's last modified time.
            sources.forEach((source) => {
                innerPromises.push(stats.lookup(source));
            });

            var promise = Promise.all(innerPromises)
                .then((modifs) => {
                    var productMTime = modifs[0];
                    for (var i = 1;i < modifs.length;++i) {
                        if (modifs[i] === false || modifs[i] > productMTime) {
                            return sources;
                        }
                    }

                    return false;
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
    getIgnoreSources(buildPath) {
        assert(this.isLoaded());

        // Compute set of source nodes not reachable by the set of out-of-date
        // build products.
        var sourceSet = new Set(Object.keys(this.forwardMappings));

        return this.getOutOfDateProducts(buildPath)
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

                found.add(next);
                if (next in this.connections) {
                    stk = stk.concat(this.connections[next]);
                }
                else {
                    leaves.add(next);
                }
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
    loadFromFile: loadFromFile,
    saveToFile: saveToFile,
    DependencyGraph: DependencyGraph
};

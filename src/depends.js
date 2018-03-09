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

    lookupForward(a) {
        assert(this.forwardMappings);
        return this.forwardMappings[a];
    }

    lookupReverse(b) {
        assert(this.reverseMappings);
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

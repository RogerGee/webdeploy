/**
 * depends.js
 *
 * @module depends
 */

const fs = require("fs");
const pathModule = require("path");
const assert = require("assert");
const { format } = require("util");

/**
 * @typedef module:depends~productObject
 *  Represents a build product result.
 * @property {string} product
 *  The build product node value
 * @property {string[]} sources
 *  The list of nodes that connect to the build product.
 */

/**
 * @callback module:depends~walkCallback
 *  Callback for walking connections/mappings.
 * @param {module:depends~DependencyGraph} graph
 *  The graph that resolved.
 * @param {string} node
 *  The forward node.
 * @param {string[]} nodelist
 *  The mappings associated with the forward node. The callback may modify
 *  this list and the changes will be saved in the graph.
 */

/**
 * Stores target dependencies such that a set of source targets is associated
 * with a set of build products. The associations are always non-trivial,
 * meaning a dependency A -> A is never represented but A -> B is represented.
 */
class DependencyGraph {
    /**
     * Creates a new DependencyGraph instance
     *
     * @param {object} [repr]
     *  The storage representation of the DependencyGraph used to load initial
     *  state.
     */
    constructor(repr) {
        if (repr) {
            // The set of raw connections and forward mappings are the same
            // initially. Then all that's left is to compute the reverse
            // mappings.
            this.connections = repr.map;
            this.forwardMappings = Object.assign({},repr.map);
            this._calcReverseMappings();
        }
        else {
            this.connections = {};
            this.forwardMappings = {};
            this.reverseMappings = {};
        }
        this.hooks = [];
    }

    /**
     * Gets the representation of the DependencyGraph that can be stored and
     * then reloaded via the constructor.
     *
     * @return {object}
     */
    getStorageRepr() {
        return {
            map: this.forwardMappings
        };
    }

    /**
     * For a target node N, obtain the complete required set of nodes that are
     * dependencies of N's output nodes.
     *
     * @return {string[]}
     */
    calculateRequired(node) {
        if (!(node in this.forwardMappings)) {
            return [];
        }

        var required = new Set();
        this.forwardMappings[node].forEach((product) => {
            if (product in this.reverseMappings) {
                this.reverseMappings[product].forEach((x) => { required.add(x) });
            }
        });

        return Array.from(required);
    }

    /**
     * Determines if the graph has been completely loaded from storage.
     *
     * @return {boolean}
     */
    isLoaded() {
        return Boolean(this.forwardMappings && this.reverseMappings);
    }

    /**
     * Gets the list of build products as denoted by the dependency graph
     * (i.e. the leaf nodes).
     *
     * @return {string[]}
     */
    getProducts() {
        assert(this.isLoaded());
        return Object.keys(this.reverseMappings);
    }

    /**
     * Determines the set of build product nodes that are out-of-date based on
     * information from the tree.
     *
     * @return {Promise<module:depends~productObject>}
     */
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

                return Promise.all(innerPromises).then((modifs) => {
                    if (modifs.some((x) => !!x)) {
                        return sources;
                    }

                    return false;
                });
            });

            promises.push(promise);
        });

        return Promise.all(promises).then((results) => {
            var changes = [];

            for (var i = 0;i < results.length;++i) {
                if (results[i]) {
                    changes.push({ product: products[i], sources: results[i] });
                }
            }

            return changes;
        });
    }

    /**
     * Determines the set of sources that can safely be ignored since they are
     * not reachable by any out-of-date build products.
     *
     * @return {Promise<Set<string>>}
     */
    getIgnoreSources(tree) {
        assert(this.isLoaded());

        // Compute set of source nodes not reachable by the set of out-of-date
        // build products.

        var sourceSet = new Set(Object.keys(this.forwardMappings));

        return this.getOutOfDateProducts(tree).then((products) => {
            for (var i = 0;i < products.length;++i) {
                var entry = products[i];

                for (var j = 0;j < entry.sources.length;++j) {
                    sourceSet.delete(entry.sources[j]);
                }
            }

            return sourceSet;
        });
    }

    /**
     * Determines if the specified source is a dependency of any product in the
     * dependency graph.
     *
     * @return {boolean}
     *  Returns false if the source wasn't found.
     */
    hasProductForSource(source) {
        assert(this.isLoaded());

        return source in this.forwardMappings;
    }

    /**
     * Determines if the specified node has any forward mappings. This means
     * there is at least one intermediate or final product associated with the
     * node.
     *
     * @return {boolean}
     */
    lookupForward(a) {
        assert(this.isLoaded());

        return this.forwardMappings[a];
    }

    /**
     * Determines if the specified node has any reverse mappings. This means
     * there is at least one source associated with the node.
     *
     * @return {boolean}
     */
    lookupReverse(b) {
        assert(this.isLoaded());

        return this.reverseMappings[b];
    }

    /**
     * Adds a raw connection to the dependency graph. The connection will denote
     * 'a' => 'b'.
     *
     * @param {string} a
     * @param {string} b
     */
    addConnection(a,b) {
        // Collapse connections that are an identity, i.e. A -> A = A. This
        // avoids having trivial build products in the graph.
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

    /**
     * Walks through each raw connection and invokes the specified callback.
     *
     * @param {module:depends~walkCallback} callback
     */
    walkConnections(callback) {
        var keys = Object.keys(this.connections);

        for (let i = 0;i < keys.length;++i) {
            callback(this,keys[i],this.connections[keys[i]]);
        }
    }

    /**
     * Creates a resolution hook that will be invoked the next time the
     * dependency graph resolves. The callback is only invoked at most one time.
     *
     * @param {module:depends~walkCallback} callback
     *  A walk connection callback that is called on the set of resolved
     *  forward mappings.
     */
    addResolveHook(callback) {
        this.hooks.push(callback);
    }

    /**
     * Calculates the forward and reverse mappings from the graph's internal
     * list of connections required for most operations on the dependency graph.
     */
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
        found.forEach((node) => { delete this.forwardMappings[node] });

        // Invoke post-resolve hooks.
        if (this.hooks.length > 0) {
            var keys = Object.keys(this.forwardMappings);

            for (let i = 0;i < this.hooks.length;++i) {
                for (let j = 0;j < keys.length;++j) {
                    var node = keys[j];
                    this.hooks[i](this,node,this.forwardMappings[node]);
                }
            }
        }
        this.hooks = [];

        this._calcReverseMappings();
    }

    /**
     * Resets the dependency graph to an empty state.
     */
    reset() {
        this.connections = {};
        delete this.forwardMappings;
        delete this.reverseMappings;
    }

    /**
     * Removes the connection(s) between the specified source and all of its
     * build products (in both directions).
     *
     * @param {string} source
     *  The value of the source node to search.
     * @param {boolean} sync
     *  If true, then the graph is resolved after making the changes.
     */
    removeConnectionGivenSource(source,sync) {
        // Remove the raw connections.
        var stk = [source];
        while (stk.length > 0) {
            var elem = stk.pop();
            if (!this.connections[elem]) {
                break;
            }

            var bucket = this.connections[elem];
            delete this.connections[elem];

            bucket.forEach((elem) => {
                stk.push(elem);
            });
        }

        if (sync) {
            this.resolve();
        }
    }

    /**
     * Removes the connection(s) between the specified product and all of its
     * build sources (in both directions).
     *
     * @param {string} product
     *  The value of the product node to search.
     * @param {boolean} sync
     *  If true, then the graph is resolved after making the changes.
     */
    removeConnectionGivenProduct(product,sync) {
        // Create function to recursively touch each node. Remove every
        // connection that leads to the product.
        var removeRecursive = (node,level) => {
            let children = this.connections[level];
            if (!children) {
                return;
            }

            let i = 0;
            while (i < children.length) {
                if (children[i] == node) {
                    children.splice(i,1);

                    if (children.length == 0) {
                        delete this.connections[level];

                        let parents = this.lookupReverse(level);
                        if (parents) {
                            parents.forEach((parent) => {
                                removeRecursive(level,parent);
                            });
                        }
                    }
                }
                else {
                    i += 1;
                }
            }
        }

        // We can only remove a product if it is truly a product (i.e. there are
        // no connections from the node to another node).
        if (!this.connections[product]) {
            // The operation requires graph resolution, so we implicitly resolve
            // the graph if it is not loaded.
            if (!this.isLoaded()) {
                this.resolve();
            }

            let parents = this.lookupReverse(product);
            if (parents) {
                parents.forEach((parent) => {
                    removeRecursive(product,parent);
                });
            }

            if (sync) {
                this.resolve();
            }
        }
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
    DependencyGraph
}

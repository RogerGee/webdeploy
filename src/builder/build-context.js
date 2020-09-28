/**
 * build-context.js
 *
 * @module builder/build-context
 */

const subsystem = require("../subsystem");

/**
 * Represents an object passed to each build plugin.
 */
class BuildContext {
    constructor(tree) {
        this.basePath = tree.getPath();
        this.nodeModules = subsystem.nodeModules;
    }
}

module.exports = {
    BuildContext
};

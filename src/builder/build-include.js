/**
 * build-include.js
 *
 * @module builder/build-include
 */

const minimatch = require("minimatch");
const { format } = require("util");
const { BuildHandler } = require("./build-handler");
const { WebdeployError } = require("../error");

function checkRegex(val) {
    return typeof val === 'string' || val instanceof RegExp;
}

/**
 * Represents a build include configuration object.
 */
class BuildInclude {
    /**
     * @param {string} key
     *  Key to help identify the include object in context.
     * @param {object} settings
     *  Properties to assign to the build include object.
     * @param {string|string[]} [settings.match]
     *  One or more direct match strings.
     * @param {string|string[]} [settings.pattern]
     *  One or more regex match strings.
     * @param {string|string[]} [settings.exclude]
     *  One or more exclude strings.
     * @param {object[]} [settings.handlers]
     *  One or more build handler object settings.
     * @param {boolean} [settings.build=true]
     *  Flag determining whether the include is considered for a build run.
     * @param {object} [settings.options]
     *  Extra options.
     */
    constructor(key,settings) {
        this.key = key;
        Object.assign(this,settings);

        // Apply defaults.

        if (typeof this.build == "undefined") {
            this.build = true;
        }

        if (typeof this.handlers == "undefined") {
            this.handlers = [];
        }

        if (typeof this.options == "undefined") {
            this.options = {};
        }

        // Convert handlers into BuildHandler instances.

        for (let i = 0;i < this.handlers.length;++i) {
            this.handlers[i] = new BuildHandler(format("%s.%d",key,i),this.handlers[i]);
        }

        // Normalize and validate properties.

        if (typeof this.match == "string") {
            this.match = [this.match];
        }
        else if (Array.isArray(this.match)) {
            this.match = this.match.slice();
        }
        else if (typeof this.match != "undefined") {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'match' property",
                this.key
            );
        }

        if (checkRegex(this.pattern)) {
            this.pattern = [this.pattern];
        }
        else if (Array.isArray(this.pattern) && !this.pattern.map(checkRegex).some((x) => !x)) {
            this.pattern = this.pattern.slice();
        }
        else if (typeof this.pattern != "undefined") {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'pattern' property",
                this.key
            );
        }

        if (checkRegex(this.exclude)) {
            this.exclude = [this.exclude];
        }
        else if (Array.isArray(this.exclude) && !this.exclude.map(checkRegex).some((x) => !x)) {
            this.exclude = this.exclude.slice();
        }
        else if (typeof this.exclude != "undefined") {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'exclude' property",
                this.key
            );
        }

        if (Array.isArray(this.handlers)) {
            this.handlers = this.handlers.slice();
        }
        else {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'handlers' property",
                this.key
            );
        }

        if (typeof this.build != "boolean") {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'build' property",
                this.key
            );
        }

        if (typeof this.options != "object") {
            throw new WebdeployError(
                "Include '%s' is malformed: invalid 'options' property",
                this.key
            );
        }
    }

    /**
     * Determines if the candidate target path is included by this include
     * object.
     *
     * @param {string} candidate
     *  The target path to check.
     *
     * @return {boolean}
     *  Returns whether the candidate is included.
     */
    doesInclude(candidate) {
        // Try excludes (glob match).

        if (this.exclude && this.exclude.some((e) => minimatch(candidate,e))) {
            return false;
        }

        // Try matches (glob match).

        if (this.match && this.match.some((m) => minimatch(candidate,m))) {
            return true;
        }

        // Try patterns (regex match).

        if (this.pattern && this.pattern.some((p) => candidate.match(p))) {
            return true;
        }

        return false;
    }
}

module.exports = {
    BuildInclude
};

/**
 * build-include.js
 *
 * @module builder/build-include
 */

const { format } = require("util");

const { WebdeployError } = require("../error");

/**
 * Represents a build include configuration object.
 */
class BuildInclude {
    /**
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

        // Normalize and validate properties.

        if (typeof this.match == "string") {
            this.match = [this.match];
        }
        else if (Array.isArray(this.match)) {
            this.match = this.match.slice();
        }
        else if (typeof this.match != "undefined") {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'match' property",this.key)
            );
        }

        if (typeof this.pattern == "string") {
            this.pattern = [this.pattern];
        }
        else if (Array.isArray(this.pattern)) {
            this.pattern = this.pattern.slice();
        }
        else if (typeof this.pattern != "undefined") {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'pattern' property",this.key)
            );
        }

        if (typeof this.exclude == "string") {
            this.exclude = [this.exclude];
        }
        else if (Array.isArray(this.exclude)) {
            this.exclude = this.exclude.slice();
        }
        else if (typeof this.exclude != "undefined") {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'exclude' property",this.key)
            );
        }

        if (Array.isArray(this.handlers)) {
            this.handlers = this.handlers.slice();
        }
        else {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'handlers' property",this.key)
            );
        }

        if (typeof this.build != "boolean") {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'build' property",this.key)
            );
        }

        if (typeof this.options != "object") {
            throw new WebdeployError(
                format("Include '%s' is malformed: invalid 'options' property",this.key)
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
        // Make sure the candidate is not excluded.

        if (this.exclude) {
            for (var i = 0;i < this.exclude.length;++i) {
                if (candidate.match(this.exclude[i])) {
                    return false;
                }
            }
        }

        // Try matches (exact match).

        if (this.match) {
            for (var i = 0;i < this.match.length;++i) {
                if (candidate == this.match[i]) {
                    return true;
                }
            }
        }

        // Try patterns (regex match).

        if (this.pattern) {
            for (var i = 0;i < this.pattern.length;++i) {
                if (candidate.match(this.pattern[i])) {
                    return true;
                }
            }
        }

        return false;
    }
}

module.exports = {
    BuildInclude
}

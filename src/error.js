/**
 * error.js
 *
 * @module error
 */

const { format } = require("util");

/**
 * Provides an exception type for all webdeploy runtime errors.
 */
class WebdeployError extends Error {
    /**
     * Creates a new WebdeployError instance.
     *
     * @param {string} err
     *  The error format string.
     * @param {...*} args
     *  Arguments to format into the error string.
     */
    constructor(err,...args) {
        super(format(err,...args));
    }
}

module.exports = {
    WebdeployError
};

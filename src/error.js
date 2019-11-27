/**
 * error.js
 *
 * @module error
 */

/**
 * Provides an exception type for all webdeploy runtime errors.
 */
class WebdeployError extends Error {
    /**
     * Creates a new WebdeployError instance.
     *
     * @param {string} err
     *  The error message.
     * @param {number} code
     *  The error code.
     */
    constructor(err,code) {
        super(err);

        this.code = code;
    }
}

module.exports = {
    WebdeployError
}

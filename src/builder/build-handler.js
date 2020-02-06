/**
 * build-handler.js
 *
 * @module builder/build-handler
 */

const { format } = require("util");

const { PLUGIN_KINDS } = require("../plugin");
const { WebdeployError } = require("../error");

/**
 * Represents a build handler configuration object
 */
class BuildHandler {
    /**
     * @param {string} key
     *  Key to help identify the handler object in context.
     * @param {object} settings
     *  Properties to assign to the build handler object.
     * @param {string} settings.id
     *  The ID of the plugin to load or define.
     * @param {boolean} [settings.dev=false]
     *  Determines if the plugin is considered for development runs.
     * @param {boolean} [settings.build=true]
     *  Determines if the plugin is considered for build runs.
     */
    constructor(key,settings) {
        this.key = key;
        Object.assign(this,settings);

        // Apply defaults.
        if (typeof this.dev === 'undefined') {
            this.dev = false;
        }
        if (typeof this.build === 'undefined') {
            this.build = true;
        }

        // Validate properties.

        if (typeof this.id != "string") {
            throw WebdeployError(
                format("Handler '%s' is malformed: invalid or missing 'id' property",this.key)
            );
        }

        if (typeof this.dev != "boolean") {
            throw WebdeployError(
                format("Handler '%s' (%s) is malformed: invalid 'dev' property",this.key,this.id)
            );
        }

        if (typeof this.build != "boolean") {
            throw WebdeployError(
                format("Handler '%s' (%s) is malformed: invalid 'build' property",this.key,this.id)
            );
        }

        // If the handler doesn't supply an inline handler, then we assume it is
        // to be loaded from a plugin.
        if (!this.handler) {
            this.loaderInfo = {
                pluginId: this.id,
                pluginVersion: this.version,
                pluginKind: PLUGIN_KINDS.BUILD_PLUGIN
            }
        }
    }

    /**
     * Creates an inline plugin object using the inline plugin handler defined
     * on the build handler.
     *
     * @return {object}
     */
    makeInlinePlugin() {
        if (!this.handler) {
            throw new WebdeployError("Cannot create inline plugin on this handler");
        }

        return {
            exec: this.handler
        }
    }
}

module.exports = {
    BuildHandler
}

/**
 * webdeploy.config.js
 *
 * This file details all available configuration schema for the
 * webdeploy.config.js file. Not all webdeploy configuration is available
 * through this file. See git-config for the other deployment configuration
 * parameters. The intent of this config file is to provide the build
 * configuration for a webdeploy project, not the deployment configuration.
 *
 * If you provide a webdeploy.config.js file, then you should commit it into the
 * git-repository. This is because the build configuration should follow the
 * project whereas the deployment configuration is specific to a deployment.
 */

const CONFIG = {
    /**
     * Specifies which deployment plugin is to be utilized for the build
     * command.
     */
    build: "write",

    /**
     * Specifies which deployment plugin is to be utilized for deployment. You
     * should specify something here since the default plugin is "exclude"
     * (which excludes everything).
     */
    deploy: "write",

    /**
     * Specifies which build plugins are to be loaded for the build
     * process. This list may be empty if nothing is to be built.

     * Build plugins transform targets into their output representation. They
     * are invoked in sequence. This may be a custom handler function or a
     * string denoting an installed handler plugin.
     *
     * By default, a handler is not made available during a development
     * run. If this is required, then set "dev" to true.
     */
    builders: [
        {
            // The name ID of the build plugin. If the plugin is inline, then
            // this name is used to register the inline plugin. An inline
            // plugin takes precendence over any external build plugins.
            plugin: "plugin-name",

            // Determines if the handler is considered during a development
            // run. The default is false.
            dev: false,

            // A custom, inline plugin implementation.
            handler: (target) => {

            }
        }
    ],

    /**
     * Defines which blobs are included as targets in the deployment.
     */
    includes: [
        {
            // Specifies the pattern that matches the path names of candidate
            // targets.
            pattern: /.*\.js$/,

            // Specifies any loaded handler plugins to explicitly ignore. This
            // can be omitted, empty or false to include all handlers. A value
            // of "true" excludes all handlers.
            excludeHandlers: [],
        }
    ]
};

module.exports = CONFIG;

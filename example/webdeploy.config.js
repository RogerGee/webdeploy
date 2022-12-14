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

module.exports = {
    /**
     * Defines the base path under the target tree. All target paths will be
     * evaluated relative to this path. The default is the root of the target
     * tree, denoted by an empty value.
     *
     * The base path is only considered when traversing the target tree for
     * potential targets, not for loading the configuration files (like this
     * one). Again, all target paths will be relative to this base but not other
     * blobs loaded under the target tree.
     */
    basePath: "",

    /**
     * Specifies a deployment plugin configuration object. This determines which
     * plugin is to be utilized for a build. The object must have at least an
     * "id" property to identify the deploy plugin.
     */
    build: {
        "id": "write"
    },

    /**
     * Specifies a deployment plugin configuration object. This determines which
     * plugin is to be utilized for deployment. The object must have at least an
     * "id" property to identify the deploy plugin.
     */
    deploy: {
        "id": "write"
    },

    /**
     * Defines which blobs are included as targets in the deployment.
     */
    includes: [
        {
            /**
             * Specifies an exact match against the path names of candidate
             * targets. This may alternatively be an array of such matches.
             */
            match: "index.js",

            /**
             * Specifies a RegExp (object or string) that matches the path names
             * of candidate targets. This may alternatively be an array of such
             * regular expressions.
             */
            pattern: /src\/.*\.js$/,

            /**
             * Specifies a RegExp (object or string) that matches the path names
             * of candidate targets to exclude. This may alternatively be an
             * array of such regular expressions.
             */
            exclude: /^src\/scripts\.js$/,

            /**
             * Determines if the include is considered for a build run. The
             * default is true.
             */
            build: true,

            /**
             * Specifies the set of build plugins that handle the targets that
             * match the pattern.
             *
             * Build plugins transform targets into their output representation. They
             * are invoked in sequence. This may be a custom handler function or a
             * string denoting an installed handler plugin.
             *
             * The list of handlers may be empty, which essentially passes the
             * targets through unchanged.
             *
             * By default, a handler is not made available during a development
             * run. If this is required, then set "dev" to true.
             */
            handlers: [
                {
                    /**
                     * Denotes the name ID of the build plugin. If the plugin is
                     * inline, then this name is used to register the inline
                     * plugin. An inline plugin takes precendence over any
                     * external build plugins.
                     */
                    id: "minify",

                    /**
                     * Lock down a version for the plugin, or specify "latest"
                     * to use the lastest available package. Defaults to latest.
                     */
                    version: "0.1.0",

                    /**
                     * Determines if the handler is considered during a
                     * development run. The default is false.
                     */
                    dev: false,

                    /**
                     * Determines if the handler is considered during a build
                     * run. The default is true.
                     */
                    build: true,

                    /**
                     * A custom, inline plugin implementation. This is optional.
                     */
                    handler: (target,settings) => {
                        return new Promise((resolve,reject) => {

                        })
                    }
                }
            ],

            /**
             * Options for the targets created by this include rule.
             *
             * Options are plugin-specific and can be accessed by both build or
             * deploy plugins.
             */
            options: {
                foo: "bar",
                baz: 45
            }
        }
    ]
};

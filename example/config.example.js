/**
 * config.example.js
 *
 * This file details all available configuration schema for the
 * config.example.js file. Not all configuration is available through this
 * file. This file is designed to be committed into the git-repository, and
 * therefore it doesn't contain configuration related to a specific
 * deployment. See git-config for the deployment configuration.
 */

const CONFIG = {
    /**
     * This is the base subtree of the target tree for all targets processed by
     * the webdeploy pipeline. This can usually be omitted if the entire target
     * tree is to be considered.
     */
    basetree: "/path/to/targets",

    /**
     * Rules define how targets are mapped to their deployment variants.
     */
    rules: [
        pattern: {
            /**
             * Tells the deployer which deployment strategy to use. This
             * corresponds to a deployment plugin. This should be specified for
             * any rule since the default deployment is "exclude".
             */
            deployment: "match",

            /**
             * Handlers operate on targets and produce the transformed
             * outputs. They are invoked in sequence. This may be a custom
             * handler function or a string denoting an installed handler
             * plugin.
             *
             * By default, a handler is not made available during a development
             * run. If this is required, then an object should be specified that
             * has the schema { handler, dev } with dev=true.
             */
            handlers: [
                "handler-name",
                function(context,stream) {
                    // ...
                },
                { handler: "handler-name", dev: true }
            ]
        }
    ]
};

module.exports = CONFIG;

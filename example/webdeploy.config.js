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

# Build Plugins

A build plugin provides functionality for converting a target into one or more output targets. Using the [target](target.md) functionality, a build plugin can elect to have its output targets recursively processed by the build system.

A build plugin is invoked via a plugin handler, which denotes the module name and any relevant settings to apply. These settings apply globally to any target.

## Interface

A build plugin is implemented as a NodeJS module. This can either be a package or a single file. See [plugins](plugins.md) for more on plugins in general. The module should provide an `id` property set to its plugin ID and a function export - `exec` - that serves as the plugin's entry point for processing a target.

The `exec` function accepts the target and a settings object derived from the plugin handler that loaded the plugin. The function returns a `Promise` that resolves to one or more output targets such as:

~~~
exec(target,settings) -> Promise
~~~

Here is a minimal example:

~~~js
module.exports = {
  exec: (target,settings) => {
    return new Promise((resolve,reject) => {
      var outputTargets = [];

      // ... Generate output targets ...

      resolve(outputTargets);
    });
  }
};
~~~

If the `Promise` is rejected, this causes a build error and the pipeline is halted.

The resolve handler may take a single scalar `Target` instance or an array of such instances.

## Dual-Plugin Interface

Both build and deploy plugins can be combined into a single NodeJS module. The module exports have a different interface that supports distinguishing between build and deploy plugins. The exports allow both `build` and `deploy` plugins to be exported together like so:

~~~js
module.exports = {
  build: {
    exec: (target,settings) => { /* ... */ }
  },
  deploy: {
    exec: (context,settings) => { /* ... */ }
  }
};
~~~

Under the dual-plugin scheme, both the build and deploy plugins have the same identifier.

## Built-In Build Plugins

The core `webdeploy` tool comes with the following built-in build plugins:

#### `pass`

Converts the target into an output target unchanged. Note: you do not need to use this plugin directly since this is the default behavior.


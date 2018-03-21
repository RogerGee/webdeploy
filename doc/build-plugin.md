Build Plugins
=============

A build plugin provides functionality for converting a target into one or more
output targets. Using the [target](target.md) functionality, a build plugin can
elect to have its output targets recursively processed by the build system.

A build plugin is invoked via a plugin handler, which denotes the module name
and any relevant settings to apply. These settings apply globally to any target.

## Interface

A build plugin is implemented as a NodeJS module. This can either be a package
or a single file. The plugin file(s) are organized under `plugins`. The plugin
ID (as denoted in a plugin handler object) maps to the directory/file name of
the module. The module provides a single function export, `exec`, that serves as
the plugins entry point for processing a target.

The `exec` function accepts the target and a settings object derived from the
plugin handler that loaded the plugin. The function returns a `Promise` that
resolves to one or more output targets such as:

* `exec(target,settings)` -> `Promise`

Here is a minimal example:

```js
module.exports = {
  exec: (target,settings) => {
    return new Promise((resolve,reject) => {
      var outputTarget = [];

      // ... Generate output targets ...

      resolve(outputTargets);
    });
  }
};
```

If the `Promise` is rejected, this causes a build error and the pipeline is
halted.

The resolve handler may take a single scalar `Target` instance or an array of
such instances.

## Default Build Plugins

Webdeploy comes with several default build plugins. There are two flavors of
such plugins: _built-in_ and _standard_. A built-in plugin cannot be removed and
is hardcoded into the webdeploy sources whereas a standard plugin ships under
`plugins` but may be electively removed.

Built-ins

#### `pass`

Converts the target into an output target unchanged; this plugin is useful for
copying files from the target tree to the deploy tree

Standard

#### `babel`

Apply babel.js to a target.

Object schema (settings properties indicate the defaults):

```js
{
  id: "babel",

  // The babel presets to load for the run.
  presets: ["env"]
}
```

#### `minify`

Minifies CSS or JS targets. Targets are identified by file extension.

Object schema (settings properties indicate the defaults):

```js
{
  id: "minify",

  // By default renames targets such that A.ext -> A.min.ext.
  rename: true
}
```

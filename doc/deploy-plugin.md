Deploy Plugins
==============

A deploy plugin provides functionality for deploying a set of output targets to
the deploy tree. Typically the deploy tree is the local filesystem but the
plugin can decide.

Writing a custom deploy plugin is useful for when the set of output targets
needs to be modified or when the deploy environment is something other than the
local filesystem. A deploy plugin can chain to another deploy plugin after it
has modified the set of output targets in some way. This behavior is fixed and
should be designed to work for every use case.

For example, suppose we wanted to combine all scripts and styles into single
files respectively then write those files to the deploy tree on disk. Our custom
deploy plugin can do the combining then chain to the built-in `write` plugin
which will write the combined files.

## Interface

A deploy plugin is similar to a [build plugin](build-plugin.md). It is
implemented as a NodeJS module (either single-file or a package). The module
exports provide a single function `exec` that serves as the entry point to the
plugin.

The `exec` function takes a `DeployContext` (documented below) instance along
with a settings object derived from the deploy plugin specification in the
config. The function returns a `Promise` whose resolution marks the completion
of the operation such as:

* `exec(context,settings)` -> `Promise`

Here is a minimal example:

```js
module.exports = {
  exec: (context,settings) => {
    return new Promise((resolve,reject) => {
      // Do some work...

      // Resolve to denote completion.
      resolve();
    });
  }
};
```

If the `Promise` is rejected, then a build error is generated and the pipeline
halted.

## `DeployContext`

A `DeployContext` object is passed to a deploy plugin. It encapsulates the set
of output targets being processed and provides support functionality for
processing the targets.

### Structure

A `DeployContext` object has the following properties:

* `DeployContext.deployPath` [String]

The absolute path to the root of the deploy tree. Any target source path is
relative to this root.

NOTE: A `Target`'s `deployPath` property is preset by the context to incorporate
the context's `deployPath`. For example, given the context's `deployPath` set to
`/path/to/deploy` and the target's `sourcePath` set to `src`, the target's
`deployPath` will be set to `/path/to/deploy/src`.

* `DeployContext.targets` [Array]

The list of output targets to process. Each item is a `Target` object.

* `DeployContext.logger` [Object]

The logger module from the core codebase. This is loaded so the plugin can
produce messages. Care should be taken to preserve the original indent level.

### Functionality

A `DeployContext` object has the following properties:

* `DeployContext.resolveTargets(newTargetPath,removeTargets)` -> `Target`

Resolves a list of targets down into a single, new target. If `newTargetPath` is
provided, then a new target is created with the given path and returned.
Otherwise the specified targets are removed and nothing is returned. The list of
`removeTargets` should contain target objects from the context's `targets` list.

* `DeployContext.chain(nextPlugin,settings)` -> `Promise`

Invokes the specified deploy plugin, which is passed the called `DeployContext`
instance. The `Promise` returned from the plugin's `exec` function is returned.
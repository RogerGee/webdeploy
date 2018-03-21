Target
======

The `Target` object encapsulates the state of a build target. A `Target`
corresponds to a single blob from the target tree which is to be included in a
deployment.

Targets are created at the beginning of the deployment pipeline during the build
phase. The [config object](config.md)'s `includes` section determines which
targets are created during this phase.

To use targets manually from a plugin,

```js
const targetModule = require("../src/target");
```

## Structure

A `Target` object has the following properties:

#### `Target.stream` [stream.PassThrough]

The stream for reading/writing a target's content.

The target's content stream has its encoding set to UTF-8. Currently the
implementation has all streams keep data buffered in memory.

#### `Target.sourcePath` [String]

The relative path under the target tree to the target, not including the target
name. For example, if the full target path is `path/to/target`, then the source
path is `path/to`. The source path is empty if the target is top-level within
the directory hierarchy.

Since the source path is relative, it will never have a leading path separator.
POSIX path separators are always used for source paths.

#### `Target.deployPath` [String]

The absolute path to a target under the deploy tree, not including the target
name. This property is not set until the deploy phase.

#### `Target.targetName` [String]

The target name; this corresponds to the blob file name. If the full target path
is `path/to/target` then the target name is `target`.

#### `Target.options` [Object]

Plugin-specific options. The functionality should treat this object as
read-only.

## Functionality

A `Target` object has the following functions:

#### `Target.getSourceTargetPath()` -> String

Obtains the full target source path, e.g. `path/to/target`. This is just a join
of the target source path and name.

#### `Target.getDeployTargetPath()` -> String

Obtains the full target deploy path, e.g. `path/to/deploy/target`. This is just
a join of the target deploy path and name.

#### `Target.setDeployPath(deployPath)` -> String

Sets the deploy path for a target. This is typically called by the
implementation during the deploy phase.

#### `Target.makeOutputTarget(newTargetName,newTargetPath,recursive)` -> Target

Creates a new `Target` based on the called target. If `newTargetName` or
`newTargetPath` are `null`, then they inherit the properties of the called
target. If `recursive` is `true`, then the new target is marked recursive and
will be processed by the build system recursively upon a plugin resolving its
output targets.

The new target inherits the options object of the called target.

#### `Target.pass()` -> Target

Creates a new `Target` that is an exact copy of the called target. This is
useful for passing a target along unchanged. Calling this function is normally
not necessary as you can just pass along the original target.

Calling `pass` does not duplicate the stream content but just passes the stream
along to the child target.

#### `Target.applySettings(pluginSettings)`

Applies default plugin settings. This is mostly used internally by the
implementation. Supported settings include:

  * `path` - an alternative base deploy path for a target

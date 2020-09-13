# Configuration

The `webdeploy` configuration determines what targets are included in a build and how they are built and deployed. There are two kinds of configuration sources: the _target tree configuration_ and the _deploy configuration_. The target tree configuration exists inside the target tree as a filesystem entry or a `git` repository blob, and the deploy configuration exists either as `git-config` entries in a `git` repository or as command-line arguments passed to the `webdeploy deploy` command.

The target tree configuration file contains configuration parameters that determine how the target tree is built and deployed. A variety of configuration file formats are allowed such as a CommonJS module or JSON object. The target tree configuration file should be committed in a project's `git` repository.

The deploy configuration is designed to contain deployment-specific configuration options. These options are specific to a given environment (e.g. where to deploy). As such, it doesn't make much sense to commit these parameters into the repository since they might change often or vary from environment to environment.

## Target Tree Configuration

This section describes the overall structure of the target tree configuration. This configuration is at the core of any project that uses `webdeploy` as its build system. The target tree configuration (sometimes called the _target configuration_ in the codebase) describes how a project is built and is a static configuration. This means that the target tree configuration remains the same regardless of the environment.

### Configuration Format and Storage
The configuration is encoded either as JavaScript code or JSON stored in a file blob. You should choose the format that best supports your project. JavaScript code is more flexible and allows you to build your own functionality into the build system whereas JSON is pretty easy to use.

If you choose JavaScript code, then the configuration is delivered via a CommonJS module. The file should be put at the root of the target tree you wish to build. Note that the target tree doesn't have to be the project root and can be configured in the deploy configuration. The following file names are supported:
- `webdeploy.config.js`
- `.webdeploy.config.js`

If you choose a subdirectory of your project as the target tree, then you will need to target that directory when executing `webdeploy`. For deploys from `git` repositories, you will have to define a `targetTree` option to denote the target tree. (See below section on **Deploy Configuration** for more on this.)

JSON-based configuration may be stored in a number of different places that include:
- `package.json` under a `webdeploy` section
- `composer.json` under a `webdeploy` section

### Configuration Structure: Overview
The target tree configuration consists of three general sections:
1. `build {object}`
2. `deploy {object}`
3. `includes {object[]}`

The `build` section describes the settings for a `webdeploy build` invocation. Likewise, the `deploy` section describes the settings for a `webdeploy deploy` invocation.

The `includes` section denotes rules for how targets are processed by the build system.

The top-level also supports the following, individual properties:

**`basePath` `{string}`**
Defines a base path under the target tree against which all target paths will be evaluated. By default, this value is empty, meaning all paths are evaluated against the root of the tree.

For example, suppose the `basePath` is set to `scripts`. If the target path is `scripts/a.js`, then the path evaluates to `a.js`. In this way, the target paths `scripts/a.js` and `a.js` are equivalent.

### The `build` and `deploy` sections
The `build` and `deploy` sections each map to a deploy plugin descriptor object. (See [the Plugins docs](./plugins.md) for more on build vs. deploy plugins.)

While the sections have the same format, they are applied in different scenarios. The type of invocation of the `webdeploy` command (i.e. `webdeploy build` or `webdeploy deploy`) determines which configuration is considered. This allows different settings for a local `build` versus a remote `deploy`. Generally, a `build` is for generating build products with a minimal deployment (e.g. for development) whereas a `deploy` is for a full project deployment.

You can omit one of the `build` or `deploy` sections but not both. For example, for projects with no development build requirements, you can just have a `deploy` section for production deployments.

Any deploy plugin descriptor object has the following base form:

```json
{
  "id": "plugin-id",
  "version": "1.0.0"
}
```

The object may have extra properties used to configure the plugin in some plugin-specific way. This object is passed into a plugin as `settings`. See [the deploy plugins docs](./deploy-plugin.md) for more on this.

### The `includes` section
The `includes` section maps to an array of _include objects_. This section is required in a `webdeploy` config.

An include object specifies rules that include targets into the build. Additionally, include objects denote zero or more transformations on the targets they include. These transformations are called _build handlers_, and each build handler maps to a build plugin that is to be executed for each included target.

Each include object has the following general form:

```js
{
  "match": "file.ext",
  // OR
  "match": ["file1.ext", "file2.ext"],

  "pattern": "src\\/.*\\.js$",
  // OR
  "pattern": ["src\\/.*\\.js$", "src\\/.*\\.jsx$"],

  "exclude": "pattern",
  // OR
  "exclude": ["pattern1", "pattern2"],

  "handlers": [ /* handler objects */ ],

  "build": false,

  "options": {
    "foo": "bar"
  }
}
```

The `match` property denotes direct matches against target paths. This means the target path must exactly match a specifier under the `match` property. The `match` property can be an array of such specifiers. If a target path matches the `match` property, the associated target is included in the build.

The `pattern` property works like the `match` property except it is a regular expression pattern that is matched against the target path. This gives more expressive power to include many input targets. If your target tree configuration is provided as a JS module, this can be a `RegExp` instance.

The `exclude` property functions like `pattern` in that it matches target paths by regular expression. However this property is used to exclude matched targets from the build. Note that only matched targets are excluded (i.e. only targets previously matched by a `match` or `pattern` can be excluded).

The `handlers` property is an array of build handler objects. This defines all of the handlers that are to be executed on the included targets. See the section below for more detail on the format of build handler objects.

The `build` property is a Boolean denoting whether the include object should be used for build runs only (i.e. invocations of `webdeploy build`). By default this property is `true`, meaning the include object is used by `webdeploy build`. This property is typically set to `false` to exclude targets that do not need to be deployed for a local build (e.g. targets whose target path and content are not modified).

The `options` property denotes a set of options to apply to every target matched by the include object. Target options are used by plugins in some implementation-defined way. This property is merely a mechanism for initially loading the target options.

#### Build Handler Object

A build handler object denotes a build plugin to execute on the targets matched by an include object.

The general structure of a build handler object:
```json
{
  "id": "plugin-id",
  "dev": false,
  "build": true
  // Plugin-specific options may follow...
}
```

The `id` property denotes the plugin ID used to look up the plugin.

The `dev` property denotes if the handler should execute in development mode via `webdeploy build --dev`. (Note that the `--dev` option is implied if not specified.) By default, this property is `false`, which means the handler does not execute in development mode and will only execute when running in production mode via `webdeploy build --prod` or `webdeploy deploy`. If the property is `true`, it will execute in development mode _and_ production mode.

The `build` property functions just like the `build` property on the parent include object. In this case, it applies just to the handler. If `build` is `false`, then the plugin will only execute via `webdeploy deploy`. By default, `build` is `true`.

In addition to the reserved, standard properties listed above, the build handler can also specify plugin-specific properties.

## Deploy Configuration

This section describes the deploy configuration. This configuration is mainly used to take a built project and write it to an external or remote location.

### Configuration Storage

`webdeploy` provides two options for storing the deploy configuration:

- in a repository's `git-config` database
- via command-line arguments to `webdeploy deploy`

When deploying via a `git` repository, you can mix both storage options. In this case, the command-line takes precedence and can be used to overwrite options loaded from the `git-config`.

If you use the `git-config` as storage, note that the options are keyed under the `webdeploy` section. This means when we lookup `option`, the system actually looks up `webdeploy.option`. Consult the `example/git-config` file for an example `git-config` file.

### Configuration Properties

The following configuration properties are enumerates as a part of the deploy configuration.

#### `targetTree`
This property defines the path to the target tree within the project. It is always relative to the project root and need not contain a leading `/` separator.

The target tree defaults to the project root if not explicitly provided.

When invoking `webdeploy deploy` on a filesystem-based project, the target tree is passed in as the first positional argument (e.g. `webdeploy deploy app`). In this case, it defaults to the current working directory.

#### `deployPath`

The deploy path defines the path to which the build result is deployed. It is only utilized for `webdeploy deploy` invocations.

For a `webdeploy build` invocation, the system internally configures the `deployPath` to the same as the internal `buildPath` variable: this cannot be overridden. This means the deploy path is set to the same path from which targets are loaded. Since there is the potential for accidentally overwriting files, it is important that the deploy plugins are written so that they do not deploy files incorrectly when executing in build-only mode.

#### `deployBranch`

The deploy branch indicates the `git` branch to utilize when loading the target tree. It is only utilized when executing `webdeploy deploy` on a `git` repository.

The value of this property can be the shorthand reference name for the branch (e.g. `master`) instead of the longhand reference name (e.g. `refs/heads/master`).

### Configuration Utilization

Not every `webdeploy` invocation utilizes all the deploy configuration properties. The below table indicates which properties are utilized based on invocation type.

| Property | `webdeploy build` | `webdeploy deploy` on filesystem | `webdeploy deploy` on git repository |
|--|--|--|--|
| `targetTree` | ✔ |✔ |✔ |
| `deployPath` |  | ✔ | ✔ |
| `deployBranch` |  | | ✔ |


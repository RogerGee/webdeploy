Configuration
=============

The webdeploy configuration determines what targets are built and deployed.
There are two kinds of configuration files, the target tree configuration and
the git-config. The target tree configuration exists inside the target tree as a
file system entry or a git repository blob. The git-config is the standard
`config` file found in a git repository.

The target tree configuration file contains configuration parameters that
determine how the target tree is built and deployed. A variety of configuration
file formats are allowed, including a `webdeploy.config.js` file or JSON-encoded
configuration included in the `package.json` file. This file should be committed
in a git-repository.

The git-config file is designed to contain deployment-specific configuration
parameters. These parameters are specific to a given environment (e.g. where to
deploy). It doesn't make much sense to commit these parameters into the
repository since they might change often or from deployment to deployment. All
webdeploy parameters are stored under the `webdeploy` section. This means when
we lookup `foobar` under the git-config, the system actually looks up
`webdeploy.foobar`.

**Important** The core functionality actually synthesizes the target tree and
git-config files. These means that when a configuration parameter is queried
all configuration sources are considered. However not all sources can represent
certain parameters. For example, an object parameter can't be stored in the
git-config natively like it can in a JSON encoding. Often this makes the choice
pretty clear. Follow the example of the files under `example` in the webdeploy
core repository.

### Target Tree Configuration

The target tree configuration consists of three general sections: `build`,
`deploy` and `includes`. The `build` section denotes the deploy plugin to run
for a build run and the `deploy` section denotes the deploy plugin to run for a
deploy run. The `includes` section denotes rules for how targets are processed
by the build system.

The `build` and `deploy` sections each map to a deploy plugin descriptor object
that has the following form:

```json
{
  "id": "plugin-id"
}
```

The object may have extra properties used to configure the plugin in some
plugin-specific way. This object is passed into a plugin as `settings`. See the
[section on deploy plugins](deploy-plugin.md) for more on this.

The `includes` section maps to an array of include objects. Each include object
has the following form:

```js
{
  "match": "file.ext",
  // OR
  "match": ["file1.ext", "file2.ext"],

  // Can be string regular expression OR (if the config file is a JS module)
  // a RegExp instance.
  "pattern": "src\\/.*\\.js$",
  // OR
  "pattern": ["src\\/.*\\.js$", "src\\/.*\\.jsx$"],

  "handlers": [ /* handler objects*/ ],

  "options": {
    "foo": "plugin-specific thingy"
  }
}
```

The include contains `match` and/or `pattern` properties that determine how
targets are selected for the rule. The `handlers` property is a list of build
plugin handlers that denote which build plugins process the targets matched.
Multiple handlers denote a sequence of handlers that operate on the target(s).

The target tree can be included in a variety of different files. NodeJS modules
and JSON files are supported:

_NodeJS module-based config files_

    webdeploy.config.js
    .webdeploy.config.js

_JSON-based config files_

    package.json
    composer.json

#### Build Handler Object

The build handler object has the following schema:

```json
{
  "id": "plugin-id",
  "dev": false,
  "build": false
}
```

The `dev` property denotes if the handler is executed for dev runs. The `build`
property determines if the handler is executed for build runs. The default value
for both of these properties is `false`.

### Git Config

The git-config is used to store deployment-specific configuration parameters. It
is not loaded on a build run since no git repository is opened. The config is
also used to cache certain values used by the build system such as last revision
deployed. All properties are stored under the `webdeploy` section.

The most important, user-defined parameters in this config file are
`targetTree`, `deployBranch` and `deployPath`.

* `targetTree` - denotes the subtree of the root tree that is the target tree; defaults to the root tree
* `deployBranch` - the head reference whose tree is to be deployed from the git repository
* `deployPath` - the base path of the deployment directory

Consult the `example/git-config` file for a sample.

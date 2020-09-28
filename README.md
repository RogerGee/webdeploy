# webdeploy

`webdeploy` is a command-line tool for building and deploying web applications from `git` repositories. It is written for NodeJS and employs `nodegit` (NodeJS bindings for `libgit2`).

## Installation

You should install `webdeploy` globally on your system:

~~~
npm install -g @webdeploy/core
~~~

Note: you should always install `webdeploy` globally. It is designed to run as a global tool.

## Synopsis

`webdeploy` is a lightweight tool that implements a build and deployment pipeline. Whereas traditionally we think of build and deploy as separate pipelines implemented using separate tools, `webdeploy` operates both pipelines in tandem. In other words, `webdeploy` integrates build processes into deployment processes: it's both a build tool and a continuous integrator.

The pipeline operates on files loaded from a project file directory. (In the documentation, we call the project directory, the _target tree_.) The target tree can either be a directory in the filesystem _or_ a tree in a `git` repository. Files loaded from the target tree are called _input targets_. Note that a file loaded from a `git` repository is called a _blob_ and is conceptually the same as a file loaded directly from the filesystem. The `webdeploy` pipeline is designed to execute identically regardless of whether the target tree is a filesystem directory or a `git` repository. There are of course some nuances to address, but the process is mostly the same. You can build your project from a checkout or from a bare repository: the result is the same. Generally, a project is built from a `git` repository for production whereas it would be built from the filesystem for local development.

The pipeline's job is to map one or more input targets within the target tree into one or more _output targets_. This can be as simple as copying a file to an output directory or manipulating the contents of a file for production. The pipeline is also capable of doing fancier things, like combining many input targets into a single output target or splitting a single input target into multiple output targets. Targets may also undergo multiple transformations before being written out.

The pipeline process collectively consists of two general phases: _build_ and _deploy_. The build phase involves transforming targets into one or more output targets respectively. This transformation at the simplest level can just be a pass-through, leaving the output target unchanged from its parent target. The deploy phase consists of processing all the output targets collectively. This may consist of combining, transforming and eventually writing to disk the set of output targets in some way. These two phases are by no means fully distinct from one another. Deploy operations can chain together so that they can execute in tandem, and deploy operations can invoke build operations. In this way, the system can recursively cycle in and out of build and deploy steps as needed to produce the final result.

The `webdeploy` tool tracks dependencies as it goes; as such, dependencies are not declared ahead of time. The dependency information is saved to disk so that on a subsequent run the system can perform an incremental build. If the target tree is a `git` repository, the system detects which blobs were modified/added by comparing against the previously deployed commit (if any). For a path-based target tree, the file modification times are used to detect changes (similar to behavior implemented by tools such as [Make](https://www.gnu.org/software/make/)).

## Config

The `webdeploy` configuration determines what targets are included in a build and how they are built and deployed. There are two kinds of configuration sources: the _target tree configuration_ and the _deploy configuration_. The target tree configuration exists inside the target tree as a file or `git` repository blob, and the deploy configuration is provided at runtime, either over the command-line or via the storage database.

See the [Configuration docs](./doc/config.md) for more details.

## Usage

There are two basic `webdeploy` commands: `webdeploy build` and `webdeploy deploy`. The `webdeploy build` command executes on a local project for development whereas the `webdeploy deploy` command executes for production. In both cases, the commands execute both build and deploy phases on the targeted project.

A core distinction between the `webdeploy build` and `webdeploy deploy` commands involves the target location of the deployment. For `webdeploy build`, the output is written in place, and for `webdeploy deploy`, the output is written to a configured destination directory.

### `webdeploy build`
~~~
Usage: webdeploy build [options] [path]

builds a local webdeploy project

Options:
  -p, --prod       Perform production build
  -d, --dev        Perform development build (default)
  -f, --force      Force full build without consulting dependencies
  -n, --no-record  Prevent creation of deployment save records
  -h, --help       display help for command
~~~

The `webdeploy build` command invokes the pipeline using the `webdeploy.build` configuration. The deploy pipeline for this mode is designed to be minimal. Namely, the deployment never targets an external deploy path. This means the command doesn't require a `webdeploy.deployPath` configuration parameter. Instead, the command implicitly configures `webdeploy.deployPath` to be the same as the build path.

This command is useful for building a project locally without writing the result to an external location. In particular, it is what you would use while developing a project that has a build step in order to execute. As such it supports a development configuration that allows for certain features to be turned off in `dev` mode. Note that `dev` mode is the default and can be disabled using the `--prod` option.

You cannot execute `webdeploy build` on a `git` repository. The tool is not designed to do this. The target tree must be a file system location.

### `webdeploy deploy`
~~~
Usage: webdeploy deploy [options] [path]

builds and deploys a remote webdeploy project

Options:
  -p, --deploy-path [path]      Denotes the deploy path destination on disk
  -b, --deploy-branch [branch]  Denotes repository branch to deploy
  -t, --deploy-tag [tag]        Denotes the repository tag to deploy
  -f, --force                   Force full deploy without consulting dependencies
  -n, --no-record               Prevent creation of deployment save records
  -h, --help                    display help for command
~~~

The `webdeploy deploy` command invokes the pipeline using the `webdeploy.deploy` configuration. The deploy pipeline in this mode is designed to target a deployment path which is configured by the `webdeploy.deployPath` configuration option. This option is typically set via a command-line parameter (e.g. `--deploy-path`) or via the storage database.

This command is really designed for `git` repositories, but it can work on normal directories also. If you have a `git` repository with a working tree, then `webdeploy` will operate on the repository and not the checked out working tree. This means any local modifications in the working tree are not considered unless they are committed.

## Plugins

`webdeploy` is designed to be highly modular, meaning most pipeline functionality is provided via plugins. A plugin encapsulates functionality for a build phase or deploy phase operation, and they come in two flavors: _build_ and _deploy_.

Plugins are delivered as NodeJS modules that are loaded by the program at runtime. Plugins are loaded as `devDependencies` of your project. The `webdeploy` CLI tool uses a proxy to load modules under your project.

There are several core plugins that are a part of `webdeploy` itself. These plugins perform basic operations (mostly related to file names and file IO). We also have a few useful plugins integrating some common web build tools. Check out the [`@webdeploy`](https://www.npmjs.com/org/webdeploy) organization on NPM for a list of plugins.

To learn more about plugins, consult [the Plugins docs](./doc/plugins.md).


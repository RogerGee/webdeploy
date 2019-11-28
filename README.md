# webdeploy

`webdeploy` is a command-line tool for building and deploying web applications from `git` repositories. It is written for NodeJS and employs `nodegit` (NodeJS bindings for `libgit2`).

Primary authors:

	Roger Gee <roger.gee@tulsalibrary.org>

## Installation

You should install `webdeploy` globally on your system, providing `webdeploy.js` to your PATH as `webdeploy`.

You can install `webdeploy` from private NPM repositories such as the one we have here at TCCL:

	$ npm install -g @tccl/webdeploy

Note: you should always install `webdeploy` globally. It is designed to run as a global tool.

## Methodology

`webdeploy` is a lightweight tool that implements a build/deployment pipeline. Whereas traditionally we think of build and deploy as separate pipelines implemented using separate tools, `webdeploy` operates both pipelines in tandem.

The pipeline operates on files loaded from a project file directory. (In the documentation, we call the project directory, the _target tree_.) The target tree can either be a directory in the filesystem _or_ a tree in a `git` repository. Files loaded from the target tree are called _input targets_. Note that a file loaded from a `git` repository is called a _blob_ and is conceptually the same as a file loaded directly from the filesystem.

The pipeline's job is to map one or more input targets within the target tree to their respective output variants. This can be as simple as copying a file to an output directory or manipulating the contents of a file for production. The pipeline is also capable of doing fancier things, like combining many input targets into a single output target or splitting a single input target into multiple output targets. Targets may also undergo multiple transformations before they reach their final, output variation. When a target is not an input target and not yet considered an output target, it is called an _intermediate target_.

It's worth noting that `webdeploy` is designed to execute the pipeline almost equally regardless of whether the target tree is a filesystem directory or `git` repository. There are of course some nuances to address, but the process is mostly the same. You can build your project from a checkout or from a bare repository: the result is the same. Generally, a project is built from a `git` repository for deployment whereas it would be built from the filesystem for local development.

The pipeline process collectively consists of two general phases: _build_ and _deploy_. The build phase involves transforming targets into one or more output targets respectively. This transformation at the simplest level can just be a pass-through, leaving the output target unchanged from its parent target.  The deploy phase consists of processing all the output targets collectively. This may consist of combining, transforming or writing to disk the set of output targets in some way. These two phases are by no means fully distinct from one another. Deploy operations can chain together so that they can execute in tandem, and deploy operations can invoke build operations. In this way, the system can recursively cycle in and out of builds and deploys as needed to produce the final result.

The `webdeploy` tool tracks dependencies as it goes, meaning dependencies are not declared ahead of time. The dependency graph is saved to disk so that on a subsequent run the system can more efficiently build/deploy the target tree. This results in the build system only processing targets that derive build products that depend on out-of-date targets. If the target tree is a `git` repository, the system detects which blobs were modified/added by comparing against the previously deployed commit (if any). For a path-based target tree, the file modification times are used to detect changes (like GNUMake).

## Config

The `webdeploy` configuration determines what targets are included in a build and how they are built and deployed. There are two kinds of configuration sources: the _target tree configuration_ and the _deploy configuration_. The target tree configuration exists inside the target tree as a filesystem entry or a `git` repository blob, and the deploy configuration exists either as `git-config` entries in a `git` repository or as command-line arguments passed to the `webdeploy deploy` command.
See the [Configuration docs](./doc/config.md) for more details.

## Usage

There are two basic `webdeploy `commands: `build` and `deploy`. The `build` command executes a build and deploys it locally (i.e. in-place) whereas the `deploy` command executes a build and deploys it in a specially configured way (typically to a target location in the filesystem). In both cases, the commands execute both build and deploy phases on the targeted project.

You'll notice that the distinction between a `build` and a `deploy` essentially boils down to how the deploy operation is carried out. However it is important to note that in both cases a _deployment operation_ is performed.

**Build**
```
$ webdeploy build [path] [--dev] [--prod] [-f]

    path     - source path of target tree to deploy; defaults to current directory

Options:
  -p, --prod   Perform production build
  -d, --dev    Perform development build (default)
  -f, --force  Force full build without consulting dependencies
  -h, --help   output usage information
```

The `webdeploy build` command invokes the pipeline using the `webdeploy.build` configuration. The deploy pipeline for this mode is designed to be minimal. Namely, the deployment never targets an external deploy path. This means the command doesn't require a `webdeploy.deployPath` configuration parameter. Instead, the command implicitly configures `webdeploy.deployPath` to be the same as the build path.

This command is useful for building a project locally without writing the result to an external location. In particular, it is what you would use while developing a project that has a build step in order to execute. As such it supports a development configuration that allows for certain features to be turned off in `dev` mode. Note that `dev` mode is the default and can be disabled using the `--prod` option.

You cannot execute `webdeploy build` on a `git` repository. The tool is not designed to do this. The target tree must be a filesystem location.

**Deploy**
```
$ webdeploy deploy [path] [-f]

    path - source path of target tree to deploy; defaults to current directory

Options:
  -f, --force                   Force full deploy without consulting dependencies
  -p, --deploy-path [path]      Denotes the deploy path destination on disk
  -b, --deploy-branch [branch]  Denotes repository branch to deploy
  -t, --deploy-tag [tag]        Denotes the repository tag to deploy
  -h, --help                    output usage information
```

The `webdeploy deploy` command invokes the pipeline using the `webdeploy.deploy` configuration. The deploy pipeline in this mode is designed to target a deployment path which is configured by the `webdeploy.deployPath` configuration option. This option is typically set via a command-line parameter (e.g. `--deploy-path`) or via the `git-config`.

This command is really designed for `git` repositories, but it can work on normal directories also. If you have a `git` repository with a working tree, then `webdeploy` will operate on the repository and not the checked out working tree. This means any local modifications in the working tree are not considered unless they are committed.

The semantics of operating on a `git` repository are different than those operating on a local path. Namely, the `git-config` is used to pull in defaults for the various parameters that are otherwise specified on the command-line. You can still override defaults using the command-line, which is useful for maintaining multiple deployments from the same `git` repository.

## Plugins

`webdeploy` is designed to be highly modular, meaning most pipeline functionality is provided via plugins. A plugin encapsulates functionality for a build phase or deploy phase operation, and they come in two flavors: _build_ and _deploy_.

Plugins are delivered as NodeJS modules that are loaded by the program at runtime. Plugins are loaded from a per-user plugin cache, and may be downloaded over HTTP from a remote repository or through NPM. Each plugin is versioned, and each version is matched exactly. This allows most functionality (except the core `webdeploy` functionality) to be locked down by version.

To learn more about plugins, consult [the Plugins docs](./doc/plugins.md).


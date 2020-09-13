# Plugins

`webdeploy` is designed to be highly modular, meaning most pipeline functionality is provided via plugins. A plugin encapsulates functionality for a build phase or deploy phase operation, and they come in two flavors: _build_ and _deploy_.

Plugins are delivered as NodeJS modules that are loaded by the program at runtime. Plugins are loaded from a per-user plugin cache, and may be downloaded over HTTP from a remote repository or through NPM. Each plugin is versioned, and each version is matched exactly. This allows most functionality (except the core `webdeploy` functionality) to be locked down by version.



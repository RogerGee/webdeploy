// sass.js - webdeploy sass plugin

const pathModule = require('path').posix;
const nodeSass = require('node-sass');

const SCSS_REGEX = /\.scss$/;

function resolveModulePath(path,callingPath) {
    // Cases we should consider:
    //  - ~path/to/module
    //     This means we evaluate relative to the root source path. In
    //     webdeploy's scheme of things, the target path would stay the same.
    //  - ./path/to/module
    //     Evaluate path relative to the calling module's path.
    //  - Anything else is evaluated as if beginning with "./".

    if (path[0] == '~') {
        var pos = 1;
        while (pos < path.length && path[pos] == '/') {
            pos += 1;
        }
        return path.substr(pos);
    }

    var pos = 0;
    if (path[0] == '.' && path[0] == '/') {
        pos = 2;
    }
    return pathModule.join(callingPath,path.substr(pos));
}

function makeCustomImporter(targets,moduleBase) {
    var targetMap = {};

    function targetPathToModulePath(targetPath) {
        if (targetPath.substr(0,moduleBase.length) == moduleBase) {
            var offset = moduleBase.length;
            while (offset < targetPath.length && targetPath[offset] == '/') {
                offset += 1;
            }

            var modulePath = targetPath.substr(offset);
        }
        else {
            var modulePath = targetPath;
        }

        return modulePath;
    }

    for (var i = 0;i < targets.length;++i) {
        // Make the module path relative to the configured moduleBase.
        var targetPath = targets[i].getSourceTargetPath();
        var modulePath = targetPathToModulePath(targetPath);

        // Remove trailing extension.
        modulePath = modulePath.substr(0,modulePath.length-5);

        targetMap[modulePath] = targets[i];
    }

    return (url,prev,done) => {
        // NOTE: This is a hack around how node-sass handles the prev
        // path. Since it always evaluates an absolute path, we added a leading
        // '/' earlier so we can preserve the webdeploy virtual path system.
        prev = prev.substr(1);
        var currentPath = targetPathToModulePath(pathModule.parse(prev).dir);

        var path = resolveModulePath(url,currentPath);
        if (path in targetMap) {
            done({ file: path, contents: targetMap[path].content });
        }
        else {
            done(new Error("Module '" + url + "' does not exist"));
        }
    };
}

module.exports = {
    id: "sass",
    exec: (context,settings) => {
        settings.moduleBase = settings.moduleBase || "";

        var scss = [];

        // Find all .scss targets.
        for (var i = 0;i < context.targets.length;++i) {
            var target = context.targets[i];

            if (target.targetName.match(SCSS_REGEX)) {
                scss.push(target);
            }
        }

        if (scss.length == 0) {
            return Promise.resolve();
        }

        // Load all content into memory. The SASS compiler will need this for
        // module resolution anyway.
        var promises = [];
        for (var i = 0;i < scss.length;++i) {
            promises.push(scss[i].loadContent());
        }

        return Promise.all(promises).then(() => {
            var promises = [];
            var importFunc = makeCustomImporter(scss,settings.moduleBase);

            // Call node-sass on each target, saving the compilation into a new
            // target with ".css" suffix.
            for (var i = 0;i < scss.length;++i) {
                let target = scss[i];

                var renderPromise = new Promise((resolve,reject) => {
                    nodeSass.render({
                        file: '/' + target.getSourceTargetPath(),
                        data: target.content,
                        includePaths: [target.sourcePath],
                        indentedSyntax: false,
                        importer: importFunc
                    }, (err, result) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            // Only include the build product if it resolved to actual content.
                            if (result.css.length > 0) {
                                var match = target.targetName.match(/(.*)\.scss$/);
                                var newPath = pathModule.join(target.sourcePath,match[1] + ".css");
                                var newTarget = context.resolveTargets(newPath,[target]);
                                newTarget.stream.end(result.css.toString('utf8'));
                            }
                            else {
                                // Remove targets that evaluated to empty.
                                context.resolveTargets(null,[target]);
                            }

                            resolve();
                        }
                    });
                });

                promises.push(renderPromise);
            }

            return Promise.all(promises);
        });
    }
}

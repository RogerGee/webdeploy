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

function makeCustomImporter(targets) {
    var targetMap = {};

    for (var i = 0;i < targets.length;++i) {
        targetMap[targets[i].getSourceTargetPath()] = targets[i];
    }

    return (url,prev,done) => {
        var path = resolveModulePath(url,prev);

        if (path in targetMap) {
            done({ contents: targetMap[path].content });
        }
        else {
            done(new Error("Module '" + url + "' does not exist"));
        }
    };
}

module.exports = {
    exec: (context,settings) => {
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
            var importFunc = makeCustomImporter(scss);

            // Call node-sass on each target, saving the compilation into a new
            // target with ".css" suffix.
            for (var i = 0;i < scss.length;++i) {
                let target = scss[i];

                var renderPromise = new Promise((resolve,reject) => {
                    nodeSass.render({
                        data: target.content,
                        includePaths: [target.sourcePath],
                        importer: importFunc
                    }, (err, result) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            var match = target.targetName.match(/(.*)\.scss$/);
                            var newPath = pathModule.join(target.sourcePath,match[1] + ".css");
                            context.resolveTargets(newPath,[target]);

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

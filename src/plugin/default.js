/**
 * default.js
 *
 * @module plugin/default
 */

const fs = require("fs");

const { mkdirParentsSync } = require("../utils");

const pass_build = {
    exec: async (target,settings) => {
        return target.pass();
    }
};

const rename_build = {
    exec: async (target,settings) => {
        const path = require("path").posix;

        var newName;
        var newPath;

        if (settings.targetNameOnly) {
            newName = settings.name || "";
            if (!newName && settings.match && settings.replace) {
                newName = target
                    .getTargetName()
                    .replace(settings.match,settings.replace);
            }
        }
        else {
            var newTargetPath = settings.name || "";
            if (!newTargetPath && settings.match && settings.replace) {
                newTargetPath = target
                    .getSourceTargetPath()
                    .replace(settings.match,settings.replace);
            }

            var parsed = path.parse(newTargetPath);
            newPath = parsed.dir;
            newName = parsed.base;
        }

        return target.pass(newName,newPath);
    }
};

const exclude_deploy = {
    exec: async (context,settings) => {
        return;
    }
};

/**
 * Provides a deploy plugin for writing out targets to disk.
 */
const write_deploy = {
    exec: (context,settings) => {
        // Remove extraneous files first (if possible); then deploy all the
        // output targets to the deploy path.

        var promises = [];

        let removefn = function(path,isTree) {
            fullPath = context.makeDeployPath(path);
            promises.push(new Promise((resolve,reject) => {
                if (isTree) {
                    fs.rmdir(fullPath, (err) => {
                        if (err) {
                            if (err.code == 'ENOENT') {
                                resolve();
                            }
                            else {
                                reject(err);
                            }
                        }
                        else {
                            context.logger.log("Removed _" + path  + "_");
                            resolve();
                        }
                    })
                }
                else {
                    fs.unlink(fullPath, (err) => {
                        if (err) {
                            if (err.code == 'ENOENT') {
                                resolve();
                            }
                            else {
                                reject(err);
                            }
                        }
                        else {
                            context.logger.log("Removed _" + path + "_");
                            resolve();
                        }
                    })
                }
            }))
        }

        return context.tree.walkExtraneous(removefn).then(() => {
            return Promise.all(promises);

        }).then(() => {
            if (typeof settings.mode == "undefined") {
                settings.mode = 0o666;
            }
            else {
                // Force Number to convert possible string values. This works
                // for octal literals encoded as strings.
                settings.mode = Number(settings.mode);
            }

            return new Promise((resolve,reject) => {
                var pathset = new Set();

                // Make sure deploy path exists.
                mkdirParentsSync(context.deployPath);

                for (var i = 0;i < context.targets.length;++i) {
                    var target = context.targets[i];

                    // Ensure parent directory exists.
                    if (!pathset.has(target.sourcePath)) {
                        pathset.add(target.sourcePath);
                        mkdirParentsSync(target.sourcePath,context.deployPath);
                    }

                    // Write data to file.
                    var outPath = target.getDeployTargetPath();
                    var outStream = fs.createWriteStream(outPath,{ mode: settings.mode });
                    target.stream.pipe(outStream);
                    context.logger.log("Writing _" + outPath + "_");
                }

                resolve();
            });
        });
    }
};

module.exports = {
    build: {
        pass: pass_build,
        rename: rename_build
    },

    deploy: {
        exclude: exclude_deploy,
        write: write_deploy
    }
};

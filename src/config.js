// config.js - webdeploy

const pathModule = require('path');
const requireFromString = require('require-from-string');
const git = require('nodegit');

function verifyConfigObject(object) {
    return true;
}

class ConfigNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

// Gets a Promise -> object representing the configration. This attempts to load
// the configuration from a number of different sources, either as a NodeJS
// module or parsing JSON.
function loadFromTree(tree) {
    var sources = {
        // Modules: The module.exports is the config object.
        modules: ["webdeploy.config.js",".webdeploy.config.js"],

        // JSON: The config object is a child of the core object.
        json: ["package.json","composer.json"]
    }

    return new Promise((resolve,reject) => {
        var loadError;

        function nextAttempt() {
            if (sources.modules.length > 0) {
                var blobName = sources.modules.pop();
                var callback = (stream) => {
                    return new Promise((resolve,reject) => {
                        var configText = "";

                        stream.on("data",(chunk) => {
                            configText += chunk;
                        })

                        stream.on("error", (err) => {
                            reject(err);
                        })

                        stream.on("end",() => {
                            var config = requireFromString(configText);

                            if (verifyConfigObject(config)) {
                                config.info = {
                                    type: "MODULE",
                                    file: blobName
                                }
                                resolve(config);
                            }
                            else {
                                reject(new Error("Config in file '" + blobName + "' failed verification"));
                            }
                        })
                    })
                }
            }
            else if (sources.json.length > 0) {
                var blobName = sources.json.pop();
                var callback = (stream) => {
                    return new Promise((resolve,reject) => {
                        var json = "";

                        stream.on("data",(chunk) => {
                            json += chunk;
                        })

                        stream.on("error",(err) => {
                            reject(err);
                        })

                        stream.on("end",() => {
                            var toplevel = JSON.parse(json);

                            if (toplevel.webdeploy) {
                                if (verifyConfigObject(toplevel.config)) {
                                    toplevel.webdeploy.info = {
                                        type: "JSON",
                                        file: blobName
                                    }
                                    resolve(toplevel.webdeploy);
                                }
                                else {
                                    reject(loadError = new Error(
                                        "Config in JSON file '" + blobName + "' failed verification"));
                                }
                            }
                            else {
                                reject(loadError = new ConfigNotFoundError(
                                    "JSON in file '" + blobName + "' did not contain webdeploy config object"));
                            }
                        })
                    })
                }
            }
            else {
                if (!loadError) {
                    loadError = new Error("Couldn't find suitable configuration file in tree");
                }
                reject(loadError);
                return;
            }

            tree.getBlob(blobName)
                .then(callback)
                .then(resolve)
                .catch((err) => {
                    // Only continue if the blob was not found.

                    if ((err.errno == git.Error.CODE.ENOTFOUND
                         && tree.name == 'RepoTree'
                         && err.message.match('does not exist in the given tree'))
                        || (err.code == 'ENOENT' && tree.name == 'PathTree')
                        || (err.name == 'ConfigNotFoundError'))
                    {
                        nextAttempt();
                    }
                    else {
                        reject(err);
                    }
                })
        }

        nextAttempt();
    })
}

module.exports = {
    types: {
        JSON: "JSON",
        MODULE: "MODULE"
    },
    loadFromTree: loadFromTree
}

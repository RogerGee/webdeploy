// config.js - webdeploy

var pathModule = require('path');
var requireFromString = require('require-from-string');

function verifyConfigObject(object) {
    return true;
}

// Gets a Promise -> object representing the configration. This attempts to load
// the configuration from a number of different sources, either as a NodeJS
// module or parsing JSON.
function loadFromTree(tree) {
    var sources = {
        // Modules: The module.exports is the config object.
        modules: ["webdeploy.config.js",".webdeploy.config.js"],

        // JSON: The config object is a child of the core object.
        json: ["package.json"]
    };

    return new Promise((resolve,reject) => {
        function nextAttempt() {
            if (sources.modules.length > 0) {
                var blobName = sources.modules.pop();
                var callback = (stream) => {
                    return new Promise((resolve,reject) => {
                        var configText = "";

                        stream.on("data",(chunk) => {
                            configText += chunk;
                        });

                        stream.on("error", (err) => {
                            reject(err);
                        });

                        stream.on("end",() => {
                            var config = requireFromString(configText);

                            if (verifyConfigObject(config)) {
                                config.info = {
                                    type: "MODULE",
                                    file: blobName
                                };
                                resolve(config);
                            }
                            else {
                                reject(Error("Config in file '" + blobName + "' failed verification"));
                            }
                        });
                    });
                };
            }
            else if (sources.json.length > 0) {
                var blobName = sources.json.pop();
                var callback = (stream) => {
                    return new Promise((resolve,reject) => {
                        var json = "";

                        stream.on("data",(chunk) => {
                            json += chunk;
                        });

                        stream.on("error",(err) => {
                            reject(err);
                        });

                        stream.on("end",() => {
                            var toplevel = JSON.parse(json);

                            if (toplevel.webdeploy) {
                                if (verifyConfigObject(toplevel.config)) {
                                    toplevel.webdeploy.info = {
                                        type: "JSON",
                                        file: blobName
                                    };
                                    resolve(toplevel.webdeploy);
                                }
                                else {
                                    reject(Error("Config in JSON file '" + blobName + "' failed verification"));
                                }
                            }
                            else {
                                reject(Error("JSON in file '" + blobName + "' did not contain webdeploy config object"));
                            }
                        });
                    });
                };
            }
            else {
                reject(Error("No blob was found that contained suitable configuration."));
            }

            tree.getBlob(blobName).then(callback,(err) => { nextAttempt(); })
                .then(resolve,(err) => { nextAttempt(); })
                .catch(reject);
        }

        nextAttempt();
    });
}

module.exports = {
    types: {
        JSON: "JSON",
        MODULE: "MODULE"
    },
    loadFromTree: loadFromTree
};

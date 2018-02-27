// config.js - webdeploy

var pathModule = require('path');
var requireFromString = require('require-from-string');

function verifyConfigObject(object) {
    return true;
}

// Gets a Promise -> object representing the configration parameters. This loads
// parameters from a blob called "webdeploy.config.js" located under the
// specified tree.
function loadFromTree(tree) {
    var configText = "";

    // Read the webdeploy.config.js blob from the tree.

    return new Promise((resolve,reject) => {
        tree.getBlob("webdeploy.config.js").then((stream) => {
            stream.on("data",(chunk) => {
                configText += chunk;
            });

            stream.on("error", (err) => {
                reject(err);
            });

            stream.on("end",() => {
                var config = requireFromString(configText);

                if (verifyConfigObject(config)) {
                    resolve(config);
                }
                else {
                    reject(Error("Config file 'webdeploy.config.js' failed verification"));
                }
            });
        }, reject);
    });
}

module.exports = {
    loadFromTree: loadFromTree
};

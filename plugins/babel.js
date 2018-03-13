// babel.js - webdeploy build plugin

const babel = require("babel-core");

module.exports = {
    exec: (target,settings) => {
        return new Promise((resolve,reject) => {
            var code = "";

            target.stream.on("data", (chunk) => {
                code += chunk;
            });

            target.stream.on("end", () => {
                var options = {

                };

                if (settings.presets) {
                    options.presets = settings.presets.map((presetModule) => { return require(presetModule); });
                }
                else {
                    options.presets = [require("babel-preset-env")];
                }

                var transpilation = babel.transform(code,options);
                var outputTarget = target.makeOutputTarget();

                outputTarget.stream.end(transpilation.code);
                resolve(outputTarget);
            });
        });
    }
};

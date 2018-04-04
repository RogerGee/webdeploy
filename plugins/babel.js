// babel.js - webdeploy build plugin

const babel = require("babel-core");

module.exports = {
    exec: (target,settings) => {
        // Normalize setting.
        settings.presets = settings.presets || [require("babel-preset-env")];
        settings.plugins = settings.plugins || [];

        return new Promise((resolve,reject) => {
            var code = "";

            target.stream.on("data", (chunk) => {
                code += chunk;
            });

            target.stream.on("end", () => {
                var options = {
                    presets: settings.presets,
                    plugins: settings.plugins
                };

                var transpilation = babel.transform(code,options);
                var outputTarget = target.makeOutputTarget();

                outputTarget.stream.end(transpilation.code);
                resolve(outputTarget);
            });
        });
    }
};

// babel.js - webdeploy build plugin

const babel = require("babel-core");

module.exports = {
    exec: (target,settings) => {
        // Normalize setting.
        settings.presets = settings.presets || [require("babel-preset-env")];
        settings.plugins = settings.plugins || [];

        return new Promise((resolve,reject) => {
            target.loadContent().then((code) => {
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

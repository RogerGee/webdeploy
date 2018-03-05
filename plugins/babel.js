// babel.js - webdeploy plugin

const babel = require("babel-core");

module.exports = {
    exec: (target) => {
        return new Promise((resolve,reject) => {
            var code = "";

            target.stream.on("data", (chunk) => {
                code += chunk;
            });

            target.stream.on("end", () => {
                var transpilation = babel.transform(code,{ presets: ["env"] });
                var outputTarget = target.makeOutputTarget();

                outputTarget.stream.end(transpilation.code);
                resolve(outputTarget);
            });
        });
    }
}

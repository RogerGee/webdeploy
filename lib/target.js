// target.js

const pathModule = require("path");
const stream = require("stream");

function makeOutputTarget(newTargetPath) {
    var memoryStream = new stream.PassThrough();
    var parsed = pathModule.parse(newTargetPath);
    var newTarget = new Target(parsed.dir,parsed.base,memoryStream);

    return newTarget;
}

function Target(path,name,input,info) {
    this.input = input;
    this.sourcePath = path;
    this.deployPath = null;
    this.targetName = name;
    this.info = info;
}

// Sets the deploy path for the target. The deploy path will be relative to the
// provided base path.
Target.prototype.setDeployPath = function(basePath) {
    this.deployPath = pathModule.join(basePath,this.sourcePath);
};

// Creates a new Target ready to receive output.
Target.prototype.makeOutputTarget = function(newTargetPath,recursive) {
    if (!newTargetPath) {
        newTargetPath = pathModule.join(this.sourcePath,this.targetName);
    }

    var newTarget = makeOutputTarget(newTargetPath);
    this.info.push(newTarget,recursive);

    return newTarget.input;
};

// Moves the target through the pipeline unchanged.
Target.prototype.pass = function() {
    this.info.push(this,false);
    return this;
};

module.exports = {
    Target: Target,
    makeOutputTarget: makeOutputTarget
};

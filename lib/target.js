// target.js

const pathModule = require("path");
const stream = require("stream");

function Target(path,name,input,info) {
    this.input = input;
    this.sourcePath = path;
    this.targetName = name;
    this.info = info;
}

Target.prototype.makeOutputTarget = function(newTargetPath,recursive) {
    var memoryStream = new stream.PassThrough();
    if (!newTargetPath) {
        newTargetPath = pathModule.join(this.sourcePath,this.targetName);
    }

    var parsed = pathModule.parse(newTargetPath);
    var newTarget = new Target(parsed.dir,parsed.base,memoryStream);

    this.info.push(newTarget,recursive);

    return memoryStream;
};

// Moves the target through the pipeline unchanged.
Target.prototype.pass = function() {
    this.info.push(this,false);
};

module.exports = {
    Target: Target
};

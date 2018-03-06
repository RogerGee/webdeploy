// target.js

const pathModule = require("path");
const stream = require("stream");
const process = require("process");

function makeOutputTarget(newTargetPath,newTargetName) {
    // If no broken down name was specified, then assume the name is in the
    // path.
    if (!newTargetName) {
        var parsed = pathModule.parse(newTargetPath);
        newTargetPath = parsed.dir;
        newTargetName = parsed.base;
    }

    // Create a duplex, Transform stream for storing the target data. Currently
    // this just keeps the data in main memory.
    var memoryStream = new stream.PassThrough();
    var newTarget = new Target(newTargetPath,newTargetName,memoryStream);

    return newTarget;
}

function Target(sourcePath,targetName,stream) {
    // Ensure the sourcePath is never an absolute path.
    if (pathModule.isAbsolute(sourcePath)) {
        throw Error("Target sourcePath cannot be an absolute path");
    }

    // The stream is available for reading/writing the target's content.
    stream.setEncoding("utf8");
    this.stream = stream;

    // The sourcePath is a relative path under the source tree to the target,
    // excluding the target name.
    this.sourcePath = sourcePath;

    // The deployPath is initially not set. It can be set later to an absolute
    // path for an output target.
    this.deployPath = null;

    // The target name serves as the identifier for the target.
    this.targetName = targetName;

    // Determines whether the target will be recursively cycled through the
    // build system.
    this.recursive = false;
}

// Gets the path to the target relative to the target's source tree. This
// includes the target name.
Target.prototype.getSourceTargetPath = function() {
    return pathModule.join(this.sourcePath,this.targetName);
};

// Gets the path to an output target in a deployment. This is an absolute path
// that includes the target name.
Target.prototype.getDeployTargetPath = function() {
    if (!this.deployPath) {
        throw Error("Deploy path is not set on target");
    }

    return pathModule.join(this.deployPath,this.targetName);
};

// Sets the deploy path for the target. The deploy path will be relative to the
// provided base path.
Target.prototype.setDeployPath = function(basePath) {
    // Verify that the path is absolute.
    if (!pathModule.isAbsolute(basePath)) {
        throw Error("Target deploy path must be an absolute path");
    }

    this.deployPath = pathModule.join(basePath,this.sourcePath);
};

// Creates an output target that inherits from the parent target.
Target.prototype.makeOutputTarget = function(newTargetName,newTargetPath,recursive) {
    if (!newTargetName) {
        newTargetName = this.targetName;
    }

    if (!newTargetPath) {
        newTargetPath = this.sourcePath;
    }

    var newTarget = makeOutputTarget(newTargetPath,newTargetName);
    newTarget.recursive = recursive;

    return newTarget;
};

// Moves the target through the pipeline unchanged.
Target.prototype.pass = function() {
    var newTarget = new Target(this.sourcePath,this.targetName,this.stream);
    newTarget.recursive = false;

    return newTarget;
};

module.exports = {
    Target: Target,
    makeOutputTarget: makeOutputTarget
};

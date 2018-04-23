// target.js

const pathModule = require("path");
const stream = require("stream");
const process = require("process");

function makeOutputTarget(newTargetPath,newTargetName,options) {
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
    var newTarget = new Target(newTargetPath,newTargetName,memoryStream,options);

    return newTarget;
}

class Target {
    constructor(sourcePath,targetName,stream,options) {
        // Ensure the sourcePath is never an absolute path.
        if (pathModule.isAbsolute(sourcePath)) {
            throw new Error("Target sourcePath cannot be an absolute path");
        }

        // The stream is available for reading/writing the target's content.
        stream.setEncoding("utf8");
        this.stream = stream;
        this.content = undefined;

        // The sourcePath is a relative path under the source tree to the target,
        // excluding the target name.
        this.sourcePath = sourcePath;

        // The source path to use under the deploy path. This is used by the
        // implementation.
        this.deploySourcePath = sourcePath;

        // The deployPath is initially not set. It can be set later to an absolute
        // path for an output target.
        this.deployPath = null;

        // The target name serves as the identifier for the target.
        this.targetName = targetName;

        // Determines whether the target will be recursively cycled through the
        // build system.
        this.recursive = false;

        // Options provided by the deployment configuration.
        this.options = Object.assign({},options) || {};

        // Used by the implementation to track target handlers.
        this.handlers = undefined;
    }

    // Reads all target content into a single string. Gets a Promise that
    // resolves to the content on completion. The content is also assigned to
    // the 'content' property on this object.
    loadContent() {
        if (this.content) {
            return Promise.resolve(this.content);
        }

        return new Promise((resolve,reject) => {
            this.content = '';

            this.stream.on("data",(chunk) => { this.content += chunk; });
            this.stream.on("end",() => { resolve(this.content); });
        });
    }

    // Gets the path to the target relative to the target's source tree. This
    // includes the target name.
    getSourceTargetPath() {
        return pathModule.posix.join(this.sourcePath,this.targetName);
    }

    // Gets the path to an output target in a deployment. This is an absolute
    // path that includes the target name.
    getDeployTargetPath() {
        if (!this.deployPath) {
            throw new Error("Deploy path is not set on target");
        }

        return pathModule.join(this.deployPath,this.targetName);
    }

    // Sets the deploy path for the target. The deploy path will be relative to
    // the provided base path.
    setDeployPath(basePath) {
        // Verify that the path is absolute.
        if (!pathModule.isAbsolute(basePath)) {
            throw new Error("Target deploy path must be an absolute path");
        }

        this.deployPath = pathModule.join(basePath,this.deploySourcePath);
    }

    // Creates an output target that inherits from the parent target.
    makeOutputTarget(newTargetName,newTargetPath,recursive) {
        if (!newTargetName) {
            newTargetName = this.targetName;
        }

        if (!newTargetPath) {
            newTargetPath = this.deploySourcePath;
        }

        var newTarget = makeOutputTarget(newTargetPath,newTargetName,this.options);
        newTarget.recursive = recursive;

        return newTarget;
    }

    // Moves the target through the pipeline unchanged. You may optionally
    // change the target name/path if desired. The content will always pass
    // through though.
    pass(newTargetName,newTargetPath) {
        var newTarget = new Target(newTargetPath || this.sourcePath,
                                   newTargetName || this.targetName,
                                   this.stream,
                                   this.options);
        newTarget.recursive = false;

        return newTarget;
    }

    // Applies the default plugin settings to the target.
    applySettings(pluginSettings) {
        if (pluginSettings.path) {
            this.deploySourcePath = pluginSettings.path;
        }
    }

    setHandlers(handlers) {
        this.handlers = handlers;
    }
}

module.exports = {
    Target: Target,
    makeOutputTarget: makeOutputTarget
};

/**
 * target.js
 *
 * @module target
 */

const pathModule = require("path");
const stream = require("stream");
const process = require("process");

const { WebdeployError } = require("./error");

/**
 * Creates a new output target.
 *
 * @param {string} newTargetPath
 *  The path for the new output target.
 * @param {string} newTargetName
 *  The name of the new output target.
 * @param {object} options
 *  The options assigned to the new output target.
 *
 * @return {module:target~Target}
 */
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

/**
 * Encapsulates output target functionality
 */
class Target {
    /**
     * Creates a new Target instance.
     *
     * @param {string} sourcePath
     * @param {string} targetName
     * @param {stream.Readable} stream
     *  The stream from which the target's content is read
     * @param {object} options
     *  Options passed for the target (and any child target)
     */
    constructor(sourcePath,targetName,stream,options) {
        // Ensure the sourcePath is never an absolute path.
        if (pathModule.isAbsolute(sourcePath)) {
            throw new WebdeployError("Target sourcePath cannot be an absolute path");
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

    /**
     * Reads all target content into a single string. The content is assigned to
     * the 'content' property on the Target object once this operation
     * completes.
     *
     * @return {Promise}
     *  Returns a Promise that evaluates to the loaded content.
     */
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

    /**
     * Gets the path to the target relative to the target's source tree. This
     * includes the target name.
     *
     * @return {string}
     */
    getSourceTargetPath() {
        return pathModule.posix.join(this.sourcePath,this.targetName);
    }

    /**
     * Gets the path to an output target in a deployment.
     *
     * @return {string} The absolute path that includes the target name.
     */
    getDeployTargetPath() {
        if (!this.deployPath) {
            throw new WebdeployError("Deploy path is not set on target");
        }

        return pathModule.join(this.deployPath,this.targetName);
    }

    /**
     * Updates the deploy path for the target.
     *
     * @param {string} basePath
     *  The base path to which the target's deploy path will be relative.
     */
    setDeployPath(basePath) {
        // Verify that the path is absolute.
        if (!pathModule.isAbsolute(basePath)) {
            throw new WebdeployError("Target deploy path must be an absolute path");
        }

        this.deployPath = pathModule.join(basePath,this.deploySourcePath);
    }

    /**
     * Creates an output target that inherits from the parent target.
     *
     * @return {module:target~Target}
     */
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

    /**
     * Moves the target through the pipeline unchanged. You may optionally
     * change the target name/path if desired. The content will always pass
     * through though.
     *
     * @param {string=} newTargetName
     *  A new name to assign to the target.
     * @param {string=} newTargetPath
     *  A new path to assign to the target.
     *
     * @return {module:target~Target}
     */
    pass(newTargetName,newTargetPath) {
        var newTarget = new Target(newTargetPath || this.sourcePath,
                                   newTargetName || this.targetName,
                                   this.stream,
                                   this.options);
        newTarget.recursive = false;

        return newTarget;
    }

    /**
     * Applies the default plugin settings to the target.
     */
    applySettings(pluginSettings) {
        if (pluginSettings.path) {
            this.deploySourcePath = pluginSettings.path;
        }
    }

    /**
     * Applies additional options to the target's list of options. The provided
     * options add to or override existing options.
     *
     * @param {object} options
     */
    applyOptions(options) {
        Object.assign(this.options,options);
    }

    /**
     * Sets the handlers that should process the target.
     *
     * @param {object[]} handlers
     *  The list of handlers to associate with the target.
     */
    setHandlers(handlers) {
        this.handlers = handlers;
    }
}

module.exports = {
    Target,
    makeOutputTarget
}

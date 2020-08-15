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
 * Makes a stream instance suitable for manipulating target content data.
 *
 * @return {stream}
 */
function makeTargetStream() {
    // For now, just create a duplex, transform stream for storing the target
    // data. This just keeps the data in main memory.
    return new stream.PassThrough();
}

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

    var memoryStream = makeTargetStream();
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

        // Options provided by the deployment configuration.
        this.options = Object.assign({},options || {});

        // Used by the implementation to track target handlers.
        this.handlers = undefined;

        // Used by the implementation to track graph depth.
        this.level = 1;
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

        if (!this.stream) {
            return Promise.reject(new WebdeployError("Target has no content"));
        }

        return new Promise((resolve,reject) => {
            this.content = '';
            this.stream.on("data",(chunk) => { this.content += chunk; });
            this.stream.on("end",() => {
                this.stream.destroy();
                this.stream = null;
                resolve(this.content);
            });
        });
    }

    /**
     * Gets the target content.
     *
     * @return {string}
     *  Returns the target content
     * @throws
     *  The method throws if content is not loaded.
     */
    getContent() {
        if (typeof this.content === 'undefined') {
            throw new WebdeployError("Target content must be loaded");
        }

        return this.content;
    }

    /**
     * Clears target content.
     */
    clearContent() {
        this.content = '';
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
     * Gets the path to the target, not including the target name.
     *
     * @return {string}
     */
    getSourcePath() {
        return this.sourcePath;
    }

    /**
     * Gets the target name component.
     *
     * @return {string}
     */
    getTargetName() {
        return this.targetName;
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
     * @param {string} newTargetName
     * @param {string} newTargetPath
     *
     * @return {module:target~Target}
     */
    makeOutputTarget(newTargetName,newTargetPath) {
        if (!newTargetName) {
            newTargetName = this.targetName;
        }

        if (!newTargetPath) {
            newTargetPath = this.deploySourcePath;
        }

        return makeOutputTarget(newTargetPath,newTargetName,this.options);
    }

    /**
     * Moves the target through the pipeline unchanged. You may optionally
     * change the target name/path if desired. The content will always pass
     * through though.
     *
     * @param {string} [newTargetName]
     *  A new name to assign to the target.
     * @param {string} [newTargetPath]
     *  A new path to assign to the target.
     *
     * @return {module:target~Target}
     */
    pass(newTargetName,newTargetPath) {
        var newTarget = new Target(
            newTargetPath || this.sourcePath,
            newTargetName || this.targetName,
            this.stream,
            this.options
        );

        newTarget.content = this.content;

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
        this.handlers = handlers.slice();
    }

    /**
     * Sets the target's handlers to match the parent target. The parent
     * target's handlers are then unset.
     *
     * @param {module:target~Target} parentTarget
     */
    setFromParent(parentTarget) {
        // Let this target inherit the remaining handlers from the parent
        // target. This allows for chaining handlers from the parent to the
        // child.
        this.level = parentTarget.level + 1;
        if (this !== parentTarget) {
            this.setHandlers(parentTarget.handlers);
            delete parentTarget.handlers;
        }
    }
}

/**
 * @callback module:target~CreateStreamFunction
 * @return {stream.Transform}
 *  Returns a transform stream suitable for the target.
 */

/**
 * Represents a delayed target
 */
class DelayedTarget {
    /**
     * @param {string} path
     *  The leading path for the target.
     * @param {string} name
     *  The target name.
     * @param {object} settings
     * @param {module:target~CreateStreamFunction} [settings.createStreamFn]
     *  A function that generates the stream for the target.
     */
    constructor(path,name,settings) {
        this.path = path;
        this.name = name;
        this.createStreamFn = settings.createStreamFn || makeTargetStream;
    }

    /**
     * Gets the full target source path.
     *
     * @return {string}
     */
    getSourceTargetPath() {
        return pathModule.posix.join(this.path,this.name);
    }

    /**
     * Creates an actual target from the delayed target.
     *
     * @return {module:target~Target}
     */
    makeTarget() {
        return new Target(this.path,this.name,this.createStreamFn());
    }
}

module.exports = {
    Target,
    DelayedTarget,
    makeTargetStream,
    makeOutputTarget
}

# Targets

Targets are a core concept in `webdeploy`. A target is the representation of an input blob as it moves through and is manipulated by the `webdeploy` pipeline.

The `Target` class encapsulates the state of a build target. An initial build `Target` corresponds to a single blob from the target tree which is to be included in a deployment. These kinds of targets are created at the beginning of the pipeline during the build phase. The target tree config object's `includes` section selects the file blobs from which the initial input targets are created during this phase.

A build consists of taking a set of input targets and converting them into a set of output targets. Intermediate output targets may also be created depending on the complexity of the build. In some cases, output targets are simply the same input target instance that has been passed through.

Most of the time, a plugin will interact with targets that have already been created and that are passed to the plugin. To use targets manually from a plugin, you can require the target module from the core codebase:

```js
const { makeOutputTarget, Target } = webdeploy_require("target");
```

<a name="module_target"></a>

## API Documentation
target.js


* [target](#module_target)
    * [~Target](#module_target..Target)
        * [new Target(sourcePath, targetName, stream, options)](#new_module_target..Target_new)
        * [.loadContent()](#module_target..Target+loadContent) ⇒ <code>Promise</code>
        * [.getSourceTargetPath()](#module_target..Target+getSourceTargetPath) ⇒ <code>string</code>
        * [.getDeployTargetPath()](#module_target..Target+getDeployTargetPath) ⇒ <code>string</code>
        * [.setDeployPath(basePath)](#module_target..Target+setDeployPath)
        * [.makeOutputTarget()](#module_target..Target+makeOutputTarget) ⇒ [<code>Target</code>](#module_target..Target)
        * [.pass([newTargetName], [newTargetPath])](#module_target..Target+pass) ⇒ [<code>Target</code>](#module_target..Target)
        * [.applySettings()](#module_target..Target+applySettings)
        * [.applyOptions(options)](#module_target..Target+applyOptions)
        * [.setHandlers(handlers)](#module_target..Target+setHandlers)
    * [~makeOutputTarget(newTargetPath, newTargetName, options)](#module_target..makeOutputTarget) ⇒ [<code>Target</code>](#module_target..Target)

<a name="module_target..Target"></a>

### target~Target
Encapsulates output target functionality

**Kind**: inner class of [<code>target</code>](#module_target)  

* [~Target](#module_target..Target)
    * [new Target(sourcePath, targetName, stream, options)](#new_module_target..Target_new)
    * [.loadContent()](#module_target..Target+loadContent) ⇒ <code>Promise</code>
    * [.getSourceTargetPath()](#module_target..Target+getSourceTargetPath) ⇒ <code>string</code>
    * [.getDeployTargetPath()](#module_target..Target+getDeployTargetPath) ⇒ <code>string</code>
    * [.setDeployPath(basePath)](#module_target..Target+setDeployPath)
    * [.makeOutputTarget()](#module_target..Target+makeOutputTarget) ⇒ [<code>Target</code>](#module_target..Target)
    * [.pass([newTargetName], [newTargetPath])](#module_target..Target+pass) ⇒ [<code>Target</code>](#module_target..Target)
    * [.applySettings()](#module_target..Target+applySettings)
    * [.applyOptions(options)](#module_target..Target+applyOptions)
    * [.setHandlers(handlers)](#module_target..Target+setHandlers)

<a name="new_module_target..Target_new"></a>

#### new Target(sourcePath, targetName, stream, options)
Creates a new Target instance.


| Param | Type | Description |
| --- | --- | --- |
| sourcePath | <code>string</code> |  |
| targetName | <code>string</code> |  |
| stream | <code>stream.Readable</code> | The stream from which the target's content is read |
| options | <code>object</code> | Options passed for the target (and any child target) |

<a name="module_target..Target+loadContent"></a>

#### target.loadContent() ⇒ <code>Promise</code>
Reads all target content into a single string. The content is assigned to
the 'content' property on the Target object once this operation
completes.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  
**Returns**: <code>Promise</code> - Returns a Promise that evaluates to the loaded content.  
<a name="module_target..Target+getSourceTargetPath"></a>

#### target.getSourceTargetPath() ⇒ <code>string</code>
Gets the path to the target relative to the target's source tree. This
includes the target name.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  
<a name="module_target..Target+getDeployTargetPath"></a>

#### target.getDeployTargetPath() ⇒ <code>string</code>
Gets the path to an output target in a deployment.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  
**Returns**: <code>string</code> - The absolute path that includes the target name.  
<a name="module_target..Target+setDeployPath"></a>

#### target.setDeployPath(basePath)
Updates the deploy path for the target.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  

| Param | Type | Description |
| --- | --- | --- |
| basePath | <code>string</code> | The base path to which the target's deploy path will be relative. |

<a name="module_target..Target+makeOutputTarget"></a>

#### target.makeOutputTarget() ⇒ [<code>Target</code>](#module_target..Target)
Creates an output target that inherits from the parent target.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  
<a name="module_target..Target+pass"></a>

#### target.pass([newTargetName], [newTargetPath]) ⇒ [<code>Target</code>](#module_target..Target)
Moves the target through the pipeline unchanged. You may optionally
change the target name/path if desired. The content will always pass
through though.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  

| Param | Type | Description |
| --- | --- | --- |
| [newTargetName] | <code>string</code> | A new name to assign to the target. |
| [newTargetPath] | <code>string</code> | A new path to assign to the target. |

<a name="module_target..Target+applySettings"></a>

#### target.applySettings()
Applies the default plugin settings to the target.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  
<a name="module_target..Target+applyOptions"></a>

#### target.applyOptions(options)
Applies additional options to the target's list of options. The provided
options add to or override existing options.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  

| Param | Type |
| --- | --- |
| options | <code>object</code> | 

<a name="module_target..Target+setHandlers"></a>

#### target.setHandlers(handlers)
Sets the handlers that should process the target.

**Kind**: instance method of [<code>Target</code>](#module_target..Target)  

| Param | Type | Description |
| --- | --- | --- |
| handlers | <code>Array.&lt;object&gt;</code> | The list of handlers to associate with the target. |

<a name="module_target..makeOutputTarget"></a>

### target~makeOutputTarget(newTargetPath, newTargetName, options) ⇒ [<code>Target</code>](#module_target..Target)
Creates a new output target.

**Kind**: inner method of [<code>target</code>](#module_target)  

| Param | Type | Description |
| --- | --- | --- |
| newTargetPath | <code>string</code> | The path for the new output target. |
| newTargetName | <code>string</code> | The name of the new output target. |
| options | <code>object</code> | The options assigned to the new output target. |



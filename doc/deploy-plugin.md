# Deploy Plugins

A deploy plugin provides functionality for deploying a set of output targets to the deploy tree. Typically the deploy tree is the local filesystem but the plugin can decide.

Writing a custom deploy plugin is useful for when the set of output targets needs to be manipulated in some way or when the deploy environment is something other than the local filesystem. A deploy plugin can chain to another deploy plugin at any point in its execution. See the section on chaining below for more information.

For example, suppose we wanted to combine all scripts and styles into single file bundles and then write those files to the deploy tree on disk. Our custom deploy plugin can do the combining then chain to the built-in `write` plugin which will write the combined files.

## Interface

A deploy plugin is similar to a [build plugin](build-plugin.md). It is implemented as a NodeJS module (either single-file or a package). The module exports provide a single function `exec` that serves as the entry point to the plugin. Additionally, a deploy plugin should advertise its ID via an `id` property.

The `exec` function takes a `DeployContext` (documented below) instance along with a settings object  derived from the deploy plugin specification in the config. The function returns a `Promise` whose resolution marks the completion of the operation such as:

~~~
exec(context,settings) -> Promise
~~~

Here is a minimal example:

~~~js
module.exports = {
  id: "plugin-id",
  exec: (context,settings) => {
    return new Promise((resolve,reject) => {
      // Do some work...

      // Resolve to denote completion.
      resolve();
    });
  }
};
~~~

If the `Promise` is rejected, then a build error is generated and the pipeline halted.

## Dual-Plugin Interface

Both build and deploy plugins can be combined into a single NodeJS module. The module exports have a different interface that supports distinguishing between `build` and `deploy` plugins. The exports allow both `build` and `deploy` plugins to be exported together like so:

~~~js
module.exports = {
  id: "plugin-id",
  build: {
    exec: (target,settings) => { /* ... */ }
  },
  deploy: {
    exec: (context,settings) => { /* ... */ }
  }
};
~~~

Under the dual-plugin scheme, both the build and deploy plugins have the same identifier.

## `DeployContext`

<a name="module_context"></a>

The `DeployContext` class is used by a deploy plugin to access and manipulate content. You'll find the `DeployContext` class in the `context` module.

* [context](#module_context)
    * [~DeployContext](#module_context..DeployContext)
        * [new DeployContext(deployPath, builder, tree)](#new_module_context..DeployContext_new)
        * _instance_
            * [.makeDeployPath(path)](#module_context..DeployContext+makeDeployPath) ⇒ <code>string</code>
            * [.setTargetsDeployPath(force)](#module_context..DeployContext+setTargetsDeployPath)
            * [.executeBuilder()](#module_context..DeployContext+executeBuilder)
            * [.createTarget(newTargetPath, options)](#module_context..DeployContext+createTarget) ⇒ <code>module:target~Target</code>
            * [.getTargets()](#module_context..DeployContext+getTargets) ⇒ <code>Array.&lt;module:target~Target&gt;</code>
            * [.forEachTarget(callback)](#module_context..DeployContext+forEachTarget)
            * [.lookupTarget(targetPath)](#module_context..DeployContext+lookupTarget) ⇒ <code>module:target~Target</code> \| <code>boolean</code>
            * [.removeTargets(removeTargets)](#module_context..DeployContext+removeTargets)
            * [.resolveTargets(newTargetPath, removeTargets, options)](#module_context..DeployContext+resolveTargets) ⇒ <code>module:target~Target</code>
            * [.chain(nextPlugin, settings)](#module_context..DeployContext+chain) ⇒ <code>Promise</code>
        * _inner_
            * [~TargetCallback](#module_context..DeployContext..TargetCallback) : <code>function</code>

<a name="module_context..DeployContext"></a>

### context~DeployContext
DeployContext

The context passed in to deploy plugins. It stores a list of output targets for processing.

**Kind**: inner class of [<code>context</code>](#module_context)  

* [~DeployContext](#module_context..DeployContext)
    * [new DeployContext(deployPath, builder, tree)](#new_module_context..DeployContext_new)
    * _instance_
        * [.makeDeployPath(path)](#module_context..DeployContext+makeDeployPath) ⇒ <code>string</code>
        * [.setTargetsDeployPath(force)](#module_context..DeployContext+setTargetsDeployPath)
        * [.executeBuilder()](#module_context..DeployContext+executeBuilder)
        * [.createTarget(newTargetPath, options)](#module_context..DeployContext+createTarget) ⇒ <code>module:target~Target</code>
        * [.getTargets()](#module_context..DeployContext+getTargets) ⇒ <code>Array.&lt;module:target~Target&gt;</code>
        * [.forEachTarget(callback)](#module_context..DeployContext+forEachTarget)
        * [.lookupTarget(targetPath)](#module_context..DeployContext+lookupTarget) ⇒ <code>module:target~Target</code> \| <code>boolean</code>
        * [.removeTargets(removeTargets)](#module_context..DeployContext+removeTargets)
        * [.resolveTargets(newTargetPath, removeTargets, options)](#module_context..DeployContext+resolveTargets) ⇒ <code>module:target~Target</code>
        * [.chain(nextPlugin, settings)](#module_context..DeployContext+chain) ⇒ <code>Promise</code>
    * _inner_
        * [~TargetCallback](#module_context..DeployContext..TargetCallback) : <code>function</code>

<a name="new_module_context..DeployContext_new"></a>

#### new DeployContext(deployPath, builder, tree)
Creates a new DeployContext instance.


| Param | Type | Description |
| --- | --- | --- |
| deployPath | <code>string</code> | The base path to which targets are written. |
| builder | <code>module:builder~Builder</code> | The builder associated with the deployment. |
| tree | <code>nodegit.Tree</code> | The git tree instance associated with the deployment. |

<a name="module_context..DeployContext+makeDeployPath"></a>

#### deployContext.makeDeployPath(path) ⇒ <code>string</code>
Creates an absolute path with a relative path within the deploy path.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| path | <code>string</code> | The relative path to create into a deploy path. |

<a name="module_context..DeployContext+setTargetsDeployPath"></a>

#### deployContext.setTargetsDeployPath(force)
Sets the deployment path for each target.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| force | <code>boolean</code> | By default, the deploy path is only set on targets that do *not* have a  deploy path set. If force is set to true, this behavior is overridden to  where the deploy path is unconditionally set. |

<a name="module_context..DeployContext+executeBuilder"></a>

#### deployContext.executeBuilder()
Wrapper for builder.execute() that sets output targets deploy paths. This is the preferred way to execute the builder.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  
<a name="module_context..DeployContext+createTarget"></a>

#### deployContext.createTarget(newTargetPath, options) ⇒ <code>module:target~Target</code>
Creates a new target having the given path.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| newTargetPath | <code>string</code> | The path for the new target (relative to the deploy path). |
| options | <code>object</code> | List of options to configure the target creation. |
| options.parents | <code>Array.&lt;module:target~Target&gt;</code> | List of parent targets used to create dependencies in the internal  dependency graph. |
| options.isOutputTarget | <code>boolean</code> | Determines if the target should be added to the context as an output  target. The default is true. |

<a name="module_context..DeployContext+getTargets"></a>

#### deployContext.getTargets() ⇒ <code>Array.&lt;module:target~Target&gt;</code>
Gets a list of all targets in the context.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  
<a name="module_context..DeployContext+forEachTarget"></a>

#### deployContext.forEachTarget(callback)
Iterates through all targets in the context and invokes the specified callback.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| callback | [<code>TargetCallback</code>](#module_context..DeployContext..TargetCallback) | The callback to invoke. |

<a name="module_context..DeployContext+lookupTarget"></a>

#### deployContext.lookupTarget(targetPath) ⇒ <code>module:target~Target</code> \| <code>boolean</code>
Looks up a target by its source path.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  
**Returns**: <code>module:target~Target</code> \| <code>boolean</code> - Returns the target if found, false otherwise.  

| Param | Type | Description |
| --- | --- | --- |
| targetPath | <code>string</code> | A path relative to the deploy path. |

<a name="module_context..DeployContext+removeTargets"></a>

#### deployContext.removeTargets(removeTargets)
Removes targets from the context. This is the preferred way of removing targets.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| removeTargets | <code>Array.&lt;module:target~Target&gt;</code> | The list of targets to remove. A single Target instance may also be  passed. |

<a name="module_context..DeployContext+resolveTargets"></a>

#### deployContext.resolveTargets(newTargetPath, removeTargets, options) ⇒ <code>module:target~Target</code>
Resolves two or more targets into a new target with the given path.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  
**Returns**: <code>module:target~Target</code> - A Target instance is only returned if a new target path was provided.  

| Param | Type | Description |
| --- | --- | --- |
| newTargetPath | <code>string</code> | The target path. The final component in the path is the target  name. Pass an empty value to avoid creating a new target. |
| removeTargets | <code>Array.&lt;module:target~Target&gt;</code> | The set of targets |
| options | <code>object</code> |  |
| options.isOutputTarget | <code>boolean</code> | True if the resulting target is added as an output target. Default is  true. |

<a name="module_context..DeployContext+execute"></a>

#### deployContext.execute(plugin, settings) ⇒ <code>Promise</code>
Executes the specified deploy plugin.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| plugin | <code>object</code> |  |
| settings | <code>module:plugin/deploy-plugin~DeployPlugin</code> | The deploy plugin configuration object to pass to the deploy plugin. |

<a name="module_context..DeployContext+chain"></a>

#### deployContext.chain(nextPlugin, settings) ⇒ <code>Promise</code>
Sends control to another deploy plugin.

**Kind**: instance method of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| nextPlugin | <code>object</code> | A loaded deploy plugin or a plugin loader object. |
| settings | <code>object</code> | Settings to pass to the deploy plugin. |

<a name="module_context..DeployContext..TargetCallback"></a>

#### DeployContext~TargetCallback : <code>function</code>
**Kind**: inner typedef of [<code>DeployContext</code>](#module_context..DeployContext)  

| Param | Type | Description |
| --- | --- | --- |
| target | <code>module:target~Target</code> | The current target being selected for this iteration. |

## Chaining

Deploy plugins can transfer execution to other deploy plugins. This allows for powerful  leveraging of different bits of functionality. When you chain from one plugin to another, you temporarily transfer control to another deploy plugin. The original plugin should only continue after the chained plugin has resolved. All deploy plugins share the same `DeployContext` instance, so all changes are available to any plugin.

**NOTE**: Special care should be taken to read each plugin's documentation. Some chaining behaviors are hard-coded. For example, the 3rd party plugin `combine` always chains to the `write` plugin. In this case we'd consider the plugin to be terminal since the targets will be written out after the chain resolves. Other plugins are more flexible and can allow for additional chains later on.

## Deploy Plugin Config Schema

In the config file, a deploy plugin is denoted by an object that has at least an `id` property denoting the deploy plugin to load. In production, you should specify a `version` to indicate a published version of a non-built-in deploy plugin. The following schema is universally available to any deploy plugin. Developers should take care not to use these properties in their own custom plugin settings.

~~~js
{
  id: "<plugin-id>",
  version: "<plugin-version>",
  
  // This property stores the set of plugins required by the deploy plugin. Each
  // array under 'build' and 'deploy' lists plugin descriptions. These are either
  // strings having the form PLUGIN@VERSION (e.g. "custom@1.2.5") or a plugin
  // description object (e.g. { id: "custom", version: "1.2.5" }).
  //
  // NOTE: built-in plugins need not and should not be specified in requires.
  requires: {
    build: [],
    deploy: []
  },

  // This property can contain a recursive deploy plugin settings object
  // denoting a default chain. An array of such objects will chain in sequence.
  chain: []
}
~~~

Note: the plugin settings object can be augmented with settings specific to the plugin in question. Consult individual plugin documentation for specific details.

## Core Plugins

The following deploy plugins are a part of the core webdeploy system. They cannot be removed.

#### `exclude`

This plugin does absolutely nothing, resolving immediately.

Object schema:

```js
{
  id: "exclude"
}
```

#### `write`

**CHAINS**: _None_

Writes output targets the to deployment tree. This is the core deploy plugin to
which most other plugins will chain.

Object schema (settings properties indicate their defaults):

```js
{
  id: "write",

  // NOTE: System umask will still apply.
  mode: 0o666
}
```


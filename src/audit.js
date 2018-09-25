// audit.js

class PluginAuditor {
    constructor() {
        this.pluginList = [];
    }

    /**
     * Adds a plugin to be audited.
     * @param string loaderInfo.pluginId   The ID of the plugin to audit.
     * @param string loaderInfo.pluginVersion The version of the plugin to audit (optional).
     */
    addPluginByLoaderInfo(loaderInfo) {
        this.pluginList.push(loaderInfo);
    }

    forEach(callback) {
        return this.pluginList.forEach(callback);
    }

    /**
     * Ensures that the local environment can load the set of plugins previously
     * supplied.
     *
     * @return Promise A Promise that resolves when all plugins have been audited.
     */
    audit() {
        // TODO


        return Promise.resolve();
    }
}

module.exports = {
    PluginAuditor
}

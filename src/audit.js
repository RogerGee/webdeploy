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

    audit() {
        // TODO


        return true;
    }

    /**
     * Gets the last error on the object. An error is set if a function returns
     * a Boolean false.
     *
     * @return string
     */
    getError() {

    }
}

module.exports = {
    PluginAuditor
}

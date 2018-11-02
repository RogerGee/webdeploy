// audit.js

const fs = require("fs");
const pathModule = require("path");
const { format } = require("util");

const sysconfig = require("./sysconfig").config;
const pluginModule = require("./plugins");
const pluginCache = require("./plugin-cache");
const { WebdeployError } = require("./error");

/**
 * Audits plugins that are required for a given build/deploy run. A
 * PluginAuditor installs missing plugins in the per-user plugin cache.
 */
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
      return new Promise((resolve,reject) => {
          const PLUGIN_DIRS = sysconfig.pluginDirectories;
          const N = this.pluginList.length;
          var count = 0;
          var rejected = false;

          function donefn() {
              if (++count >= N) {
                  resolve();
              }
          }

          function errfn(err) {
              rejected = true;
              reject(err);
          }

          for (let i = 0;!rejected && i < this.pluginList.length;++i) {
              let index = 0;
              let pluginInfo = this.pluginList[i];
              let { pluginId, pluginVersion } = pluginInfo;

              // Make fully-qualified plugin ID with version. Omit version if
              // latest; this allows us to maintain latest and versioned
              // separately.
              if (pluginVersion && pluginVersion != "latest") {
                  pluginId = format("%s@%s",pluginId,pluginVersion);
              }

              if (pluginModule.isDefaultPlugin(pluginInfo)) {
                  donefn();
                  continue;
              }

              function completefn() {
                  if (rejected) {
                      return;
                  }

                  if (index < PLUGIN_DIRS.length) {
                      let next = pathModule.join(PLUGIN_DIRS[index++],pluginId)

                      fs.stat(next, (err,stats) => {
                          if (!err && stats.isDirectory()) {
                              donefn();
                          }
                          else {
                              completefn();
                          }
                      })
                  }
                  else {
                      if (!pluginInfo.pluginVersion) {
                          errfn(new WebdeployError(
                              format("Plugin '%s' must have a version constraint",pluginId)));
                          return;
                      }

                      pluginCache.installPluginDirect(pluginInfo,donefn,errfn);
                  }
              }

              completefn();
          }
      })
    }
}

module.exports = {
    PluginAuditor
}

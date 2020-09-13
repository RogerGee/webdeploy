/**
 * package.js
 *
 * @module package
 */

const fs = require("fs");
const path = require("path");
const { format } = require("util");
const http = require("http");
const https = require("https");
const urlparse = require("url").parse;
const child_process = require("child_process");
const tar = require("tar");

const { WebdeployError } = require("./error");
const { mkdirParents, rmdirParents } = require("./utils");

const TARBALL_MIME_TYPES = [
    /application\/(x-)?gzip/,
    /application\/octet-stream/
];

class PackageInstall {
    constructor(installPath,packageName,packageVersion) {
        this.installPath = installPath;
        this.packageName = packageName;
        this.packageVersion = packageVersion;

        // Create package path using configured install path and package name
        // plus version.
        if (this.packageDir) {
            this.packageDir = this.packageDir;
        }
        else {
            this.packageDir = format("%s@%s",packageName,packageVersion);
        }
        this.packagePath = path.join(this.installPath,this.packageDir);
    }

    /**
     * Checks if the package is already installed; creates the package directory
     * if not.
     *
     * @param {function} donefn
     *  Called with 'true' if the package already exists.
     * @param {function} errfn
     *  Called when an error occurs.
     */
    initialize(donefn,errfn) {
        mkdirParents(this.packagePath,this.installPath).then(
            (ndirs) => {
                donefn(ndirs == 0);
            },
            errfn
        );
    }

    rollback(donefn,errfn) {
        rmdirParents(this.installPath,this.packagePath).then(
            () => {
                donefn();
            },
            errfn
        );
    }

    /**
     * @return {string}
     */
    getPackageLabel() {
        return this.packageDir;
    }

    /**
     * @return {object}
     */
    getPackageComponents() {
        return {
            packageName: this.packageName,
            packageVersion: this.packageVersion
        };
    }

    /**
     * Gets the path to the last installed package.
     *
     * @return {string}
     */
    getPackagePath() {
        return this.packagePath;
    }

    /**
     * Loads the last installed package via require().
     *
     * @return {*}
     */
    require() {
        return require(this.packagePath);
    }
}

function rollback_packlist(packlist,donefn,errfn) {
    async function do_rollback() {
        let i = 0;
        while (i < packlist.length) {
            const pack = packlist[i];
            await new Promise((resolve,reject) => {
                pack.rollback(resolve,reject);
            });
            i += 1;
        }
    }

    do_rollback().then(donefn).catch(errfn);
}

/**
 * Callback for when package installation completes.
 * @callback module:package~doneCallback
 * @param {boolean} didInstall
 *  True if the package was installed, false if it was already installed and was
 *  not overwritten.
 */

class PackageInstaller {
    /**
     * @param {object} options
     * @param {string} options.installPath
     * @param {string} [options.packageDir]
     * @param {object} [options.logger]
     * @param {boolean} [options.overwrite]
     * @param {boolean} [options.noscripts]
     * @param {boolean} [options.performInstall]
     */
    constructor(options) {
        Object.assign(this,options);

        if (typeof this.installPath !== "string") {
            throw new Error("Install path is not configured");
        }

        if (typeof this.overwrite === 'undefined') {
            this.overwrite = true;
        }

        if (typeof this.noscripts === 'undefined') {
            this.noscripts = false;
        }

        if (typeof this.performInstall === 'undefined') {
            this.performInstall = true;
        }

        this.preinstall = null;
    }

    /**
     * Sets a callback to be executed once before the next installation attempt.
     *
     * @param {function} callback
     */
    once(callback) {
        this.preinstall = callback;
    }

    /**
     * Installs a package.
     *
     * @param {string} packageName
     * @param {string} packageVersion
     * @param {module:package~doneCallback} donefn
     *  Invoked when the operation completes.
     * @param {function} failfn
     *  Invoked when the specified package was not found.
     * @param {function} errfn
     *  Invoked when an error occurs.
     */
    installPackage(packageName,packageVersion,donefn,failfn,errfn) {
        const pack = new PackageInstall(this.installPath,packageName,packageVersion);

        // Ensure the package path exists before installation.
        pack.initialize(
            (already) => {
                if (already && !this.overwrite) {
                    donefn(pack);
                    return;
                }

                if (typeof this.preinstall === 'function') {
                    this.preinstall(pack);
                    this.preinstall = null;
                }

                this.installImpl(
                    pack,
                    () => {
                        donefn(pack);
                    },
                    () => {
                        pack.rollback(failfn,errfn);
                    },
                    (err) => {
                        pack.rollback(() => { errfn(err); },errfn);
                    }
                );
            },
            errfn
        );
    }

    installPackageMultiple(packageList,donefn,failfn,errfn) {
        const packlist = packageList.map(
            ([name,version]) => new PackageInstall(this.installPath,name,version)
        );

        const init = Promise.all(packlist.map((pack) => {
            return new Promise((resolve,reject) => {
                pack.initialize(resolve,reject);
            });
        }));

        init.then((results) => {
            const filtered = packlist.filter((pack,index) => {
                return !results[index];
            });

            this.installMultipleImpl(
                filtered,
                () => {
                    donefn(packlist);
                },
                () => {
                    rollback_packlist(filtered,failfn,errfn);
                },
                (err) => {
                    rollback_packlist(filtered,() => { errfn(err); },errfn);
                }
            );
        });

        init.catch(errfn);
    }

    installImpl(pack,donefn,failfn,errfn) {
        throw new Error("Must implement installImpl");
    }

    installMultipleImpl(packlist,donefn,failfn,errfn) {
        const do_install = async () => {
            let i = 0;
            while (i < packlist.length) {
                const pack = packlist[i];
                const result = await new Promise((resolve,reject) => {
                    this.installImpl(
                        pack,
                        () => { resolve(true); },
                        () => { resolve(false); },
                        reject
                    );
                });

                if (!result) {
                    failfn(pack);
                    return;
                }

                i += 1;
            }

            donefn();
        };

        do_install().catch(errfn);
    }

    installHTTP(pack,url,donefn,failfn,errfn) {
        var req = url.substring(0,5) == "https" ? https : http;

        if (this.logger) {
            this.logger.log(format("Downloading %s...",url));
        }

        const request = req.get(url, (res) => {
            const { statusCode } = res;
            const contentType = res.headers['content-type'];

            // Make sure the request was successful.
            if (statusCode != 200) {
                if (statusCode == 404) {
                    failfn(url);
                }
                else {
                    errfn(new WebdeployError(format("Failed request to '%s'",url)));
                }

                return;
            }

            // Make sure response was tarball.
            if (!TARBALL_MIME_TYPES.some((regex) => regex.test(contentType))) {
                errfn(
                    new WebdeployError(
                        format(
                            "Server returned invalid package response type: '%s'",
                            contentType
                        )
                    )
                );
                return;
            }

            // Extract the tarball.
            this.extractTarball(pack,res,donefn,errfn);
        });

        request.on("error",errfn);
    }

    extractTarball(pack,inputStream,donefn,errfn) {
        if (this.logger) {
            this.logger.log(format("Extracting archive for package '%s'...",pack.getPackageLabel()));
        }

        var tarstream = tar.x({
            cwd: pack.getPackagePath(),
            strip: this.tarballStrip
        });

        tarstream.on('warn',errfn);
        tarstream.on('err',errfn);
        tarstream.on('end',() => {
            // Run NPM install if configured.
            if (this.performInstall) {
                this.runNpmInstall(pack,donefn,errfn);
            }
            else {
                donefn();
            }
        });

        inputStream.pipe(tarstream);
    }

    runNPMCommand(args,cwd,hasStdout,donefn,errfn) {
        const command = process.platform == 'win32' ? 'npm.cmd' : 'npm';

        const stdio = ['ignore','ignore','inherit'];
        if (hasStdout) {
            stdio[1] = 'pipe';
        }

        const proc = child_process.spawn(command,args,{
            cwd,
            stdio
        });

        proc.on('exit', (code,signal) => {
            if (signal) {
                errfn(
                    new WebdeployError(
                        format(
                            "The 'npm' subprocess exited with signal '%s'",
                            signal
                        )
                    )
                );
            }
            else if (code != 0) {
                errfn(
                    new WebdeployError(
                        format(
                            "The 'npm' subprocess exited non-zero"
                        )
                    )
                );
            }
            else {
                donefn();
            }
        });

        return proc.stdout;
    }

    runNpmInstall(pack,donefn,errfn) {
        if (this.logger) {
            this.logger.log(format("Executing 'npm install' on extracted archive"));
        }

        const args = [
            "install",
            "-s",
            "--no-package-lock",
            "--no-audit",
            "--production"
        ];
        if (this.noscripts) {
            args.push("--ignore-scripts");
        }

        this.runNPMCommand(args,pack.getPackagePath(),false,donefn,errfn);
    }
}

class HTTPPackageInstaller extends PackageInstaller {
    constructor(options) {
        super(options);

        if (!Array.isArray(this.baseURLs)) {
            throw new Error("HTTPPackageInstaller: option 'baseURLs' is required");
        }

        this.suffix = this.suffix || ".tar.gz";
    }

    installImpl(pack,donefn,failfn,errfn) {
        let { packageName, packageVersion } = pack.getPackageComponents();

        var match = packageName.match('^(@[^/]+)/(.*)$');
        var packagePath = packageName;
        if (match) {
            packageName = match[2];
        }

        var path = format(
            "%s/%s@%s%s",
            packagePath,
            packageName,
            packageVersion,
            this.suffix
        );

        var index = 0;
        var n = this.baseURLs.length;
        let failInnerFn = () => {
            var curindex = index++;

            this.installHTTP(
                pack,
                format("%s/%s",this.baseURLs[curindex].replace(/\/$/,''),path),
                donefn,
                index >= n ? failfn : failInnerFn,
                errfn
            );
        };

        failInnerFn();
    }
}

class NPMPackageInstaller extends PackageInstaller {
    constructor(options) {
        super(options);

        if (typeof this.downloadViaNPM !== "boolean") {
            this.downloadViaNPM = !!this.downloadViaNPM;
        }

        if (!this.downloadViaNPM && !Array.isArray(this.npmRegistries)) {
            throw new Error("NPMPackageInstaller: option 'npmRegistries' is required");
        }

        // We need to strip off the first directory in a package tarball from
        // NPM.
        this.tarballStrip = 1;
    }

    installImpl(pack,donefn,failfn,errfn) {
        if (this.downloadViaNPM) {
            this.installNPMCmd([pack],donefn,failfn,errfn);
        }
        else {
            this.installNPMManual(pack,donefn,failfn,errfn);
        }
    }

    installMultipleImpl(packlist,donefn,failfn,errfn) {
        if (this.downloadViaNPM) {
            this.installNPMCmd(packlist,donefn,failfn,errfn);
        }
        else {
            PackageInstaller.prototype.installMultipleImpl.call(this,packlist,donefn,failfn,errfn);
        }
    }

    installNPMCmd(packlist,donefn,failfn,errfn) {
        if (packlist.length == 0) {
            donefn();
            return;
        }

        const do_install = async () => {
            const results = await this.downloadNPMTarballs(packlist);

            let index = 0;
            while (index < results.length) {
                try {
                    await this.installNPMPack(results[index]);
                } catch (err) {
                    errfn(err);
                    return;
                }

                index += 1;
            }

            index < results.length ? failfn() : donefn();
        };

        do_install().catch(errfn);
    }

    async downloadNPMTarballs(packlist) {
        const args = [
            // Allow error logs to be displayed on stderr to provide feedback.
            '--loglevel',
            'error',

            // Use pack command to grab tarball using npm download/cache
            // mechanism.
            'pack'
        ];

        for (let i = 0;i < packlist.length;++i) {
            args.push(packlist[i].getPackageLabel());
        }

        const results = await new Promise((resolve,reject) => {
            const chunks = [];
            const stdout = this.runNPMCommand(
                args,
                this.installPath,
                true,
                () => {
                    const lines = Buffer.concat(chunks).toString("utf8")
                          .split("\n")
                          .map((s) => s.trim())
                          .filter((s) => !!s);

                    resolve(lines.map((line,index) => {
                        return {
                            tarball: path.join(this.installPath,line),
                            pack: packlist[index]
                        };
                    }));
                },
                reject
            );

            stdout.on("data",(chunk) => {
                chunks.push(chunk);
            });
        });

        return results;
    }

    async installNPMPack(result) {
        // Extract package tarball.
        await new Promise((resolve,reject) => {
            const inputStream = fs.createReadStream(result.tarball);
            this.extractTarball(result.pack,inputStream,resolve,reject);
        });

        // Unlink tarball file.
        await new Promise((resolve,reject) => {
            fs.unlink(result.tarball,(err) => {
                err ? reject(err) : resolve();
            });
        });
    }

    installNPMManual(pack,donefn,failfn,errfn) {
        let { packageName, packageVersion } = pack.getPackageComponents();

        let packageNamespace = "";
        const match = packageName.match('^(@[^/]+)/(.*)$');
        if (match) {
            packageNamespace = match[1] + "%2f";
            packageName = match[2];
        }

        const path = format(
            "%s%s/-/%s-%s.tgz",
            packageNamespace,
            packageName,
            packageName,
            packageVersion
        );

        const do_install = async () => {
            let index = 0;
            const num = this.npmRegistries.length;
            while (index < num) {
                try {
                    const result = await this.installNPMRegistry(
                        pack,
                        this.npmRegistries[index],
                        path
                    );

                    if (result) {
                        break;
                    }

                } catch (err) {
                    errfn(err);
                    return;
                }

                index += 1;
            }

            index >= num ? failfn() : donefn();
        };

        do_install().catch(errfn);
    }

    async installNPMRegistry(pack,registryURL,path) {
        const url = format(
            "%s/%s",
            registryURL.replace(/\/$/,''),
            path
        );

        return new Promise((resolve,reject) => {
            this.installHTTP(
                pack,
                url,
                () => { resolve(true); },
                () => { resolve(false); },
                reject
            );
        });
    }
}

module.exports = {
    HTTPPackageInstaller,
    NPMPackageInstaller
};

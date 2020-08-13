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
const { mkdirParents } = require("./utils");

const TARBALL_MIME_TYPES = [
    /application\/(x-)?gzip/,
    /application\/octet-stream/
];

class PackageInstaller {
    /**
     * @param {object} options
     * @param {string} options.installPath
     * @param {string} [options.packageDir]
     */
    constructor(options) {
        Object.assign(this,options);

        if (typeof this.installPath !== "string") {
            throw new Error("Install path is not configured");
        }

        this.packagePath = null;
    }

    installPackage(packageName,packageVersion,donefn,failfn,errfn) {
        // Create package path using configured install path and package name
        // plus version.
        var packageDir;
        if (this.packageDir) {
            packageDir = this.packageDir;
        }
        else {
            packageDir = format("%s@%s",packageName,packageVersion);
        }
        this.packagePath = path.join(this.installPath,packageDir);

        // Ensure the package path exists before installation.
        this.initialize(
            () => {
                this.installImpl(...arguments);
            },
            errfn
        );
    }

    installImpl(packageName,packageVersion,donefn,failfn,errfn) {
        throw new Error("Must implement installImpl");
    }

    installHTTP(url,donefn,failfn,errfn) {
        var req = url.substring(0,5) == "https" ? https : http;

        req.get(url, (res) => {
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

            // Extract the tarball, then run npm install.
            this.extractTarball(
                res,
                () => {
                    this.runNpmInstall(donefn,errfn);
                },
                errfn
            );
        });
    }

    extractTarball(res,donefn,errfn) {
        if (this.logger) {
            var parts = urlparse(res.url);
            this.logger.log(format("Extracting archive '%s'...",path.parse(parts.path).base));
        }

        var tarstream = tar.x({
            cwd: this.packagePath,
            strip: this.tarballStrip
        });

        tarstream.on('warn',errfn);
        tarstream.on('err',errfn);
        tarstream.on('end',donefn);

        res.pipe(tarstream);
    }

    runNpmInstall(donefn,errfn) {
        if (this.logger) {
            this.logger.log(format("Executing 'npm install' on extracted archive"));
        }

        if (process.platform == 'win32') {
            var command = 'npm.cmd';
        }
        else {
            var command = 'npm';
        }

        var proc = child_process.spawn(command,["install","-s"], {
            cwd: this.packagePath,
            stdio: ['ignore','ignore','inherit']
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
    }

    initialize(donefn,errfn) {
        mkdirParents(this.packagePath,this.installPath, (err) => {
            if (err && err.code != 'EEXIST') {
                errfn(err);
            }
            else {
                donefn();
            }
        });
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

    installImpl(packageName,packageVersion,donefn,failfn,errfn) {
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

        if (!Array.isArray(this.npmRegistries)) {
            throw new Error("NPMPackageInstaller: option 'npmRegistries' is required");
        }

        // We need to strip off the first directory in a package tarball from
        // NPM.
        this.tarballStrip = 1;
    }

    installImpl(packageName,packageVersion,donefn,failfn,errfn) {
        var packageNamespace = "";
        var match = packageName.match('^(@[^/]+)/(.*)$');
        if (match) {
            packageNamespace = match[1] + "%2f";
            packageName = match[2];
        }

        var path = format(
            "%s%s/-/%s-%s.tgz",
            packageNamespace,
            packageName,
            packageName,
            packageVersion
        );

        var index = 0;
        var n = this.npmRegistries.length;
        let failInnerFn = () => {
            var curindex = index++;

            this.installNPMRegistry(
                this.npmRegistries[curindex],
                path,
                donefn,
                index >= n ? failfn : failInnerFn,
                errfn
            );
        };

        failInnerFn();
    }

    installNPMRegistry(registryURL,path,donefn,failfn,errfn) {
        var url = format(
            "%s/%s",
            registryURL.replace(/\/$/,''),
            path
        );

        this.installHTTP(url,donefn,failfn,errfn);
    }
}

module.exports = {
    HTTPPackageInstaller,
    NPMPackageInstaller
};

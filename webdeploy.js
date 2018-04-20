#!/usr/bin/env node

// webdeploy.js

const commander = require("commander");
const path = require("path");
const logger = require("./src/logger");
const deployer = require("./src/deployer");

function reject(err) {
    logger.error("*[FAIL]* " + String(err));
    logger.resetIndent();
    if (err.stack) {
        console.error("");
        console.error(err.stack);
    }
}

commander.version("0.0.0","-v, --version");

commander.command("deploy [path]")
    .option("-d, --dry-run","Perform dry run")
    .option("-f, --force","Force full deploy without consulting dependencies")
    .action((sourcePath,cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_DEPLOY,
            force: cmd.force ? true : false
        };

        if (sourcePath) {
            var localPath = path.resolve(sourcePath);
        }
        else {
            var localPath = path.resolve(".");
        }

        deployer.deployDecide(localPath,options,(type) => {
            logger.log("*[DEPLOY]* _" + type + "_: exec " + localPath);
            logger.pushIndent();
        }, reject)
            .then(() => {
                logger.popIndent();
                logger.log("*[DONE]*");
            }).catch(reject);
    });

commander.command("build [path]")
    .option("-r, --dry-run","Perform dry run")
    .option("-p, --prod","Perform production build")
    .option("-d, --dev","Perform development build (default)")
    .option("-f, --force","Force full build without consulting dependencies")
    .action((sourcePath,cmd) => {
        if (cmd.prod && cmd.dev) {
            logger.error("webdeploy: build: Please specify one of _prod_ or _dev_.".bold);
            return;
        }

        var options = {
            dryRun: cmd.dryRun ? true : false,
            dev: cmd.dev || !cmd.prod,
            type: deployer.types.TYPE_BUILD,
            force: cmd.force ? true : false
        };

        if (sourcePath) {
            var localPath = path.resolve(sourcePath);
        }
        else {
            var localPath = path.resolve(".");
        }

        logger.log("*[BUILD]* _local_: exec " + localPath);
        logger.pushIndent();

        deployer.deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");
        }).catch(reject);
    });

commander.command("server")
    .option("-p, --path","Unix domain socket path")
    .action((cmd) => {
        throw new Error("webdeploy server mode is not implemented yet");
    });

commander.parse(process.argv);

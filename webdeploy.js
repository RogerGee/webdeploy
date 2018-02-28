#!/usr/bin/env node

// webdeploy.js

var commander = require("commander");
var nodegit = require("nodegit");
var path = require("path");
var logger = require("./lib/logger");
var deployer = require("./lib/deployer");

function reject(err) {
    logger.error("*[FAIL]* " + String(err));
    logger.resetIndent();
}

commander.version("0.0.0","-v, --version");

commander.command("deploy [path]")
    .option("-d, --dry-run","Perform dry run")
    .action((sourcePath,cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_DEPLOY
        };

        if (sourcePath) {
            var localPath = path.resolve(sourcePath);
        }
        else {
            var localPath = path.resolve(".");
        }

        logger.log("*[DEPLOY]* _local_: exec " + localPath);
        logger.pushIndent();

        deployer.deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");
        }, reject);
    });

commander.command("deploy-repo [path]")
    .option("-d, --dry-run","Perform dry run")
    .action((repo) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_DEPLOY
        };

        logger.log("*[DEPLOY]* _git_: exec " + repo);
        logger.pushIndent();

        deployer.deployRepository(repo,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");
        }, reject);
    });

commander.command("build")
    .option("-d, --dry-run","Perform dry run")
    .action((cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_BUILD
        };

        var localPath = path.resolve(".");

        logger.log("*[BUILD]* _local_: exec " + localPath);
        logger.pushIndent();

        deployer.deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");
        }, reject);
    });

commander.command("server")
    .option("-p, --path","Unix domain socket path")
    .action((cmd) => {
        throw new Error("webdeploy server mode is not implemented yet");
    });

commander.parse(process.argv);

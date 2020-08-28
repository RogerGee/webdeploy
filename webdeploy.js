#!/usr/bin/env node

// webdeploy.js

const commander = require("commander");
const path = require("path");

const logger = require("./src/logger");
const commands = require("./src/commands");
const sysconfig = require("./src/sysconfig");
const storage = require("./src/storage");
const { WebdeployError } = require("./src/error");
const { version: VERSION } = require("./package.json");

function resolveSourcePath(sourcePath) {
    if (sourcePath) {
        return path.resolve(sourcePath);
    }
    return path.resolve(".");
}

function reject(err) {
    logger.resetIndent();
    logger.error("\n*[FAIL]* " + String(err));
    if (err.stack) {
        console.error("");
        console.error(err.stack);
    }
}

commander.version(VERSION,"-v, --version");

commander.command("configdef <key> [value]")
    .description("gets/sets defaults for a webdeploy project tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((key,value,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        commands.configdef(localPath,key,value).catch(reject);
    });

commander.command("config <deploy-path> <key> [value]")
    .description("gets/sets deployment config for a webdeploy project tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((deployPath,key,value,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        commands.config(localPath,deployPath,key,value).catch(reject);
    });

commander.command("info [deploy-path]")
    .description("displays info about a webdeploy tree")
    .option("-p, --path [path]","Specifies the project path (default is current directory)")
    .action((deployPath,cmd) => {
        var localPath = resolveSourcePath(cmd.path);
        commands.info(localPath,deployPath).catch(reject);
    });

commander.command("deploy [path]")
    .description("runs the deploy task on a webdeploy project")
    .option("-f, --force","Force full deploy without consulting dependencies")
    .option("-p, --deploy-path [path]","Denotes the deploy path destination on disk")
    .option("-b, --deploy-branch [branch]","Denotes repository branch to deploy")
    .option("-t, --deploy-tag [tag]","Denotes the repository tag to deploy")
    .action((sourcePath,cmd) => {
        if (cmd.deployBranch && cmd.deployTag) {
            throw new WebdeployError("Invalid arguments: specify one of deploy-branch and deploy-tag");
        }

        var options = {
            type: commands.CONFIG_TYPES.TYPE_DEPLOY,
            force: cmd.force ? true : false,
            deployBranch: cmd.deployBranch,
            deployTag: cmd.deployTag,
            deployPath: cmd.deployPath
        };

        var localPath = resolveSourcePath(sourcePath);

        commands.deployDecide(localPath, options, (type) => {
            logger.log("*[DEPLOY]* *" + type + "*: exec " + localPath);
            logger.pushIndent();

        }, reject).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");

        }).catch(reject)
    });

commander.command("build [path]")
    .description("runs the build task on a webdeploy project")
    .option("-p, --prod","Perform production build")
    .option("-d, --dev","Perform development build (default)")
    .option("-f, --force","Force full build without consulting dependencies")
    .action((sourcePath,cmd) => {
        if (cmd.prod && cmd.dev) {
            logger.error("webdeploy: build: Please specify one of *prod* or *dev*.".bold);
            return;
        }

        var options = {
            dev: cmd.dev || !cmd.prod,
            type: commands.CONFIG_TYPES.TYPE_BUILD,
            force: cmd.force ? true : false
        };

        var localPath = resolveSourcePath(sourcePath);

        logger.log("*[BUILD]* *local*: exec " + localPath);
        logger.pushIndent();

        commands.deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");

        }, reject).catch(reject);
    });

// Run the program.

sysconfig.load((config) => {
    storage.load();

    commander.parse(process.argv);

}, reject);

#!/usr/bin/env node

// webdeploy.js

const commander = require("commander");
const path = require("path");

const logger = require("./src/logger");
const commands = require("./src/commands");
const { load: loadSysconfig } = require("./src/sysconfig");
const { VERSION } = require("./package.json")

function reject(err) {
    logger.resetIndent();
    logger.error("\n*[FAIL]* " + String(err));
    if (err.stack) {
        console.error("");
        console.error(err.stack);
    }
}

commander.version(VERSION,"-v, --version");

commander.command("deploy [path]")
    .description("runs the deploy task on a webdeploy project")
    .option("-f, --force","Force full deploy without consulting dependencies")
    .action((sourcePath,cmd) => {
        var options = {
            type: commands.types.TYPE_DEPLOY,
            force: cmd.force ? true : false
        }

        if (sourcePath) {
            var localPath = path.resolve(sourcePath);
        }
        else {
            var localPath = path.resolve(".");
        }

        commands.deployDecide(localPath,options,(type) => {
            logger.log("*[DEPLOY]* _" + type + "_: exec " + localPath);
            logger.pushIndent();
        }, reject)
            .then(() => {
                logger.popIndent();
                logger.log("*[DONE]*");
            }).catch(reject);
    })

commander.command("build [path]")
    .description("runs the build task on a webdeploy project")
    .option("-p, --prod","Perform production build")
    .option("-d, --dev","Perform development build (default)")
    .option("-f, --force","Force full build without consulting dependencies")
    .action((sourcePath,cmd) => {
        if (cmd.prod && cmd.dev) {
            logger.error("webdeploy: build: Please specify one of _prod_ or _dev_.".bold);
            return;
        }

        var options = {
            dev: cmd.dev || !cmd.prod,
            type: commands.types.TYPE_BUILD,
            force: cmd.force ? true : false
        }

        if (sourcePath) {
            var localPath = path.resolve(sourcePath);
        }
        else {
            var localPath = path.resolve(".");
        }

        logger.log("*[BUILD]* _local_: exec " + localPath);
        logger.pushIndent();

        commands.deployLocal(localPath,options).then(() => {
            logger.popIndent();
            logger.log("*[DONE]*");

        }, reject).catch(reject);
    })

// Run the program.

loadSysconfig().then(() => {
    commander.parse(process.argv);

    if (commander.args.length == 0) {
        commander.help();
    }

}).catch(reject);

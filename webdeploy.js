#!/usr/bin/env node

// webdeploy.js

var commander = require("commander");
var nodegit = require("nodegit");
var path = require("path");
var deployer = require("./lib/deployer");

function reject(err) {
    console.log("[FAIL] " + String(err));
}

commander.version("0.0.0","-v, --version");

commander.command("deploy")
    .option("-d, --dry-run","Perform dry run")
    .action((cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_DEPLOY
        };

        deployer.deployLocal(path.resolve("."),options).then(() => {
            console.log("DONE");
        }, reject);
    });

commander.command("deploy <repo>")
    .option("-d, --dry-run","Perform dry run")
    .action((repo,cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_DEPLOY
        };

        deployer.deployRepository(repo,options).then(() => {
            console.log("DONE");
        }, reject);
    });

commander.command("build")
    .option("-d, --dry-run","Perform dry run")
    .action((cmd) => {
        var options = {
            dryRun: cmd.dryRun ? true : false,
            type: deployer.types.TYPE_BUILD
        };

        deployer.deployLocal(path.resolve("."),options).then(() => {
            console.log("DONE");
        }, reject);
    });

commander.command("server")
    .option("-p, --path","Unix domain socket path")
    .action((cmd) => {
        throw new Error("webdeploy server mode is not implemented yet");
    });

commander.parse(process.argv);

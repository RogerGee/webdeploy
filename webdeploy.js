#!/usr/bin/env node

// webdeploy.js

var commander = require("commander");
var nodegit = require("nodegit");
var path = require("path");
var builder = require("./lib/builder");
var deployer = require("./lib/deployer");

function deploy_server(cmd) {
    throw new Error("webdeploy server mode is not implemented yet");
}

commander.version("0.0.0","-v, --version");

commander.command("deploy")
    .option("-d, --dry-run","Perform dry run")
    .action((cmd) => {
        deployer.deployLocal(path.resolve("."),cmd.dryRun ? cmd.dryRun : false);
    });

commander.command("deploy <repo>")
    .option("-d, --dry-run","Perform dry run")
    .action((repo,cmd) => {
        deployer.deployRepo(repo,cmd.dryRun ? cmd.dryRun : false);
    });

commander.command("build")
    .action((cmd) => {
        builder.buildPath(path.resolve("."));
    });

commander.command("server")
    .option("-p, --path","Unix domain socket path")
    .action(deploy_server);

commander.parse(process.argv);

#!/usr/bin/env node

// webdeploy.js

var commander = require("commander");
var nodegit = require("nodegit");

function deploy_server(cmd) {
    throw new Error("webdeploy server mode is not implemented yet");
}

function deploy_instance(repo,cmd) {
    var deployer = require("./lib/deployer");

    deployer.deploy(repo);
}

commander.version("0.0.0","-v, --version");

commander.command("deploy <repo>")
    .option("-d, --dry-run","Perform dry run")
    .action(deploy_instance);

commander.command("server")
    .option("-p, --path","Unix domain socket path")
    .action(deploy_server);

commander.parse(process.argv);

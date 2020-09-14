#!/usr/bin/env node

/**
 * webdeploy.js
 *
 * Copyright (C) Roger P. Gee
 */

const logger = require("./src/logger");
const sysconfig = require("./src/sysconfig");
const storage = require("./src/storage");
const { commander, webdeploy_fail } = require("./src/commands");
const { WebdeployError } = require("./src/error");

// Run the program.

sysconfig.load((config) => {
    storage.load();
    commander.parse(process.argv);

}, webdeploy_fail);

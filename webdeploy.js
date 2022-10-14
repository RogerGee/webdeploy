#!/usr/bin/env node

/**
 * webdeploy.js
 *
 * Copyright (C) Roger P. Gee
 */

const subsystem = require("./src/subsystem");
const { commander, webdeploy_fail } = require("./src/commands");

async function main() {
    try {
        await subsystem.load();
        commander.parse(process.argv);
    } catch (err) {
        webdeploy_fail(err);
    }
}

// Run the program.

main();

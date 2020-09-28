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
    } catch (err) {
        webdeploy_fail(err);
    }

    commander.parse(process.argv);
}

// Run the program.

main();

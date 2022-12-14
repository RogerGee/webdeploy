/**
 * logger.js
 *
 * @module logger
 */

const os = require("os");
const process = require("process");
const colors = require("colors");

const INDENT_STEP = 2;
var indent = 0;

function makeIndent() {
    return " ".repeat(indent);
}

function parseMessage(message) {
    // Log syntax provides a simple, Markdown-inspired format.
    const REGEX = /(^|[^\w]+)(\*[^\s*]\*|\*[^\s*].*?[^\s*]\*|_[^\s_]_|_[^\s_].*?[^\s_]_)($|(?=[^\w]+))/g;
    const UNDERLINE_TOKEN = '_';
    const BOLD_TOKEN = '*';

    var n = 0;
    var output = "";

    while (true) {
        var match = REGEX.exec(message);
        if (!match) {
            break;
        }
        output += message.substr(n,match.index + match[1].length - n);

        var type = match[2][0];
        var inner = match[2].substr(1,match[2].length-2);
        if (type == UNDERLINE_TOKEN) {
            output += inner.underline;
        }
        else if (type == BOLD_TOKEN) {
            output += inner.bold;
        }

        n = match.index + match[1].length + match[2].length;
    }

    output += message.substr(n,message.length - n);

    return output;
}

module.exports = {
    /**
     * Resets the logging indentation.
     */
    resetIndent() {
        indent = 0;
    },

    /**
     * Increases the logging indentation.
     *
     * @param {number} n
     *  The number of steps to indent.
     */
    pushIndent(n) {
        if (!n || n <= 0) {
            n = 1;
        }

        indent += INDENT_STEP * n;
    },

    /**
     * Decreases the logging indentation.
     *
     * @param {number} n
     *  The number of steps to unindent.
     */
    popIndent(n) {
        if (!n || n <= 0) {
            n = 1;
        }

        indent -= INDENT_STEP * n;
        if (indent < 0) {
            indent = 0;
        }
    },

    /**
     * Sets the logging indentation level.
     *
     * @param {number} n
     *  The indentation step level.
     */
    setIndent(n) {
        indent = INDENT_STEP * n;
    },

    /**
     * Logs a message to the standard output.
     *
     * @param {string} message
     *  The message to log.
     * @param {boolean} noeol
     *  Determines if an end-of-line is appended to the log message.
     */
    log(message,noeol) {
        if (noeol) {
            process.stdout.write(makeIndent() + parseMessage(message));
        }
        else {
            process.stdout.write(makeIndent() + parseMessage(message) + os.EOL);
        }
    },

    /**
     * Logs a message to the standard error.
     *
     * @param {string} message
     *  The message to log.
     * @param {boolean} noeol
     *  Determines if an end-of-line is appended to the log message.
     */
    error(message,noeol) {
        if (noeol) {
            process.stderr.write(makeIndent() + parseMessage(message).red);
        }
        else {
            process.stderr.write(makeIndent() + parseMessage(message).red + os.EOL);
        }
    },

    /**
     * Encapsulates making a string plural.
     *
     * @param {number} n
     *  The number of things rerepresented by the thing.
     * @param {string} thing
     *  The think to potentially make plural.
     * @param {string} suffix
     *  The suffix to append if the thing is plural.
     */
    plural(n,thing,suffix) {
        if (!suffix) {
            suffix = "s";
        }

        return n > 1 || n == 0 ? thing + suffix : thing;
    },

    filter(val,defval) {
        if (val) {
            return val;
        }
        if (typeof defval === 'undefined') {
            return '(none)';
        }
        return defval;
    }
};

// logger.js

const colors = require("colors");

const INDENT_STEP = 2;
var indent = 0;

function makeIndent() {
    return " ".repeat(indent);
}

function parseMessage(message) {
    // Log syntax provides a simple, Markdown-inspired format.
    const REGEX = /(^|[\s]+[^\w\s]*)(\*[^\s*]\*|\*[^\s*].*?[^\s*]\*|_[^\s_]_|_[^\s_].*?[^\s_]_)($|(?=[^\w\s]*[\s]+))/g;
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
    resetIndent: () => {
        indent = 0;
    },

    pushIndent: () => {
        indent += INDENT_STEP;
    },

    popIndent: () => {
        indent -= INDENT_STEP;
        if (indent < 0) {
            indent = 0;
        }
    },

    setIndent: (newIndent) => {
        indent = newIndent;
    },

    log: (message) => {
        console.log(makeIndent() + parseMessage(message));
    },

    error: (message) => {
        console.log(makeIndent() + parseMessage(message).red);
    },

    plural: (n,thing,suffix) => {
        if (!suffix) {
            suffix = "s";
        }

        return n > 1 ? thing + suffix : thing;
    }
};

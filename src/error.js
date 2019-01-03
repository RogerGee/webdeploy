// error.js

class WebdeployError extends Error {
    constructor(err,code) {
        super(err);

        this.code = code;
    }
}

module.exports = {
    WebdeployError
}

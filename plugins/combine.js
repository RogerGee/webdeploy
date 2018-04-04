// combine.js - webdeploy deploy plugin

function doesTargetBelong(target,mapping) {
    var targetPath = target.getSourceTargetPath();

    if (mapping.match) {
        if (Array.isArray(mapping.match)) {
            var matches = mapping.match;
        }
        else {
            var matches = [mapping.match];
        }

        for (var i = 0;i < matches.length;++i) {
            if (matches[i] == targetPath) {
                return true;
            }
        }
    }

    if (mapping.pattern) {
        if (Array.isArray(mapping.pattern)) {
            var patterns = mapping.pattern;
        }
        else {
            var patterns = [mapping.pattern];
        }

        for (var i = 0;i < patterns.length;++i) {
            if (targetPath.match(patterns[i])) {
                return true;
            }
        }
    }

    return false;
}

function processMapping(context,mapping) {
    // Combine all the targets together, observing any ordering provided by the
    // mapping object. This will resolve the targets down, preventing them from
    // being used in another mapping.

    var newTarget;

    return new Promise((resolve,reject) => {
        var targets = [];

        if (!mapping.match && !mapping.pattern) {
            reject(new Error("combine: Plugin mappings.mapping object missing match/pattern properties"));
            return;
        }

        for (var i = 0;i < context.targets.length;++i) {
            if (doesTargetBelong(context.targets[i],mapping)) {
                targets.push(context.targets[i]);
            }
        }

        if (targets.length == 0) {
            resolve();
            return;
        }

        // Sort targets by ordering.

        if (mapping.ordering) {
            var pos = 0;
            var names = targets.map((x) => { return x.getSourceTargetPath(); });
            for (let i = 0;i < mapping.ordering.length;++i) {
                var indexOf = names.indexOf(mapping.ordering[i]);
                if (indexOf >= 0 && indexOf != pos) {
                    var target = targets[indexOf];
                    targets.splice(indexOf,1);
                    targets.splice(pos,0,target);
                    var targetName = names[indexOf];
                    names.splice(indexOf,1);
                    names.splice(pos,0,targetName);
                }
                pos += ( indexOf >= 0 ) ? 1 : 0;
            }
        }

        // Create the new target. The new target is an output target if no
        // handlers are available. Otherwise the target is pushed into the
        // builder to execute the handlers at a later time.

        var handlers = mapping.handlers
            ? context.builder.loadHandlerPlugins(mapping.handlers) : [];

        newTarget = context.resolveTargets(mapping.target,
                                           targets,
                                           { isOutputTarget:handlers.length == 0 });

        if (handlers.length > 0) {
            context.builder.pushInitialTargetWithHandlers(newTarget,handlers);
        }

        // Combine all targets together into the new output target.

        let counter = 0;

        function transfer(chunk) {
            newTarget.stream.write(chunk);
        }

        function combineFile() {
            if (counter < targets.length) {
                var target = targets[counter++];

                target.stream.on('data',transfer);
                target.stream.on('end',combineFile);
            }
            else {
                newTarget.stream.end();
                resolve();
            }
        }

        combineFile();
    });
}

module.exports = {
    exec: (context,settings) => {
        return new Promise((resolve,reject) => {
            var promises = [];

            if (!settings.mappings) {
                reject(new Error("combine: Plugin settings missing 'mappings' attribute"));
                return;
            }

            for (var i = 0;i < settings.mappings.length;++i) {
                promises.push(processMapping(context,settings.mappings[i]));
            }

            Promise.all(promises).then(() => {
                return context.executeBuilder().then(() => {
                    return context.chain("write",settings.writeSettings);
                });
            }).then(resolve,reject);
        });
    }
};

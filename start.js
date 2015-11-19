var dns = require('dns');
process.env.DEBUG = 'configurator';
var debug = require('debug')('configurator');
var child_process = require('child_process');
var HAProxy = require('haproxy');
var Mark = require("markup-js");
var fs = require("fs");
var jsdiff = require('diff');
var RSVP = require('rsvp');

const CONFIG_REFRESH_TIMEOUT_MILLS = "1000" || process.env.REFRESH_TIMEOUT;

var configurationFile = "/usr/local/etc/haproxy/haproxy.cfg";

var haproxy = new HAProxy('/tmp/haproxy.sock', {
    config: configurationFile,
    socket: "/tmp/haproxy.sock"
});

/**
 * Promise that will verify configuration
 *
 * @type {Promise}
 */
var verifyConfiguration = () => new Promise(function (resolve, reject) {
    console.log('Verifying configuration');
    if (!fs.existsSync(configurationFile)) return reject('Configuration file can not be found file=' + configurationFile);
    haproxy.verify(function (err, working) {
        if (err) {
            return reject(err);
        }
        if (!working) {
            console.log('Configuration have warnings');
        } else {
            console.log('Configuration verified successfully');
        }
        resolve();
    });
});

/**
 * Promise that will start the HAProxy child process
 * @type {Promise}
 */
var startHAProxy = () => new Promise(function (resolve) {
    console.log('Starting the HAPRoxy child process')
    var childProccess = child_process.spawn('haproxy', ["-f", configurationFile], {
        stdio: 'inherit'
    });

    // Make sure when HAProxy exited we exit too
    childProccess.on('exit', function (code, signal) {
        console.log('HAProxy process exited code=%s signal=%s', code, signal);
        process.exit(code);
    });
    resolve();
});

/**
 * Logging HAProxy stats to the STDOUT
 */
function logStats() {
    setInterval(function () {
        haproxy.stat('-1', '-1', '-1', function (err, stats) {
            console.log('HAProxy Stats stats=%j', stats);
        });
    }, 10000);
}

/**
 * Function that retuns a promise that will resolve into the context
 * for template rendering
 *
 * @returns {Promise}
 */
function generateContext() {
    var services = {
        frontend: '_frontend._tcp.marathon.mesos',
        hooks: '_hooks._tcp.marathon.mesos'
    };
    var promises = {};
    debug('Generating context for following services=%j', Object.keys(services));
    Object.keys(services).map(serviceName => promises[serviceName] = new Promise((resolve, reject) => {
            var dnsName = services[serviceName];
            debug('Sending SRV request for entry=%j', dnsName);
            dns.resolveSrv(dnsName, function (err, result) {
                if (err) {
                    debug('DNS SRV record failed to be resolved entry=%s error=', dnsName, err);
                    return reject(err);
                }
                debug('DNS Name SRV resolved entry=%s resolved=%j', dnsName, result);
                resolve(result);
            });
        })
    );
    return RSVP.hashSettled(promises);
}

/**
 * This function prepares result of the RSVP.hashSettled function
 * into the context usable for template parsing
 *
 * @returns {Promise}
 */
function prepareContext(result) {
    var context = {};
    Object.keys(result).map(key => {
        var promiseResult = result[key];
        if (promiseResult && promiseResult.state === 'fulfilled') context[key] = promiseResult.value;
    });
    return Promise.resolve(context);
}

/**
 * Promise that will do the configuration refresh of the HAProxy (if required)
 *
 * @param reload - if true and configuration changed HAProxy config reload will be triggered
 * @returns {Promise}
 */
function regenerateConfiguration(reload) {
    var originalConfig = fs.existsSync(configurationFile) ? fs.readFileSync(configurationFile, 'utf8') : '';
    var template = fs.readFileSync(__dirname + "/haproxy.cfg.template", "utf8");
    return generateContext().then(prepareContext).then(function (context) {
        return new Promise(function (resolve, reject) {
            debug('Merging template with context=%j', context);
            var newConfig = Mark.up(template, context);
            var diff = jsdiff.diffTrimmedLines(originalConfig, newConfig, {ignoreWhitespace: true});
            if (diff.length > 1 || (diff[0].added || diff[0].removed)) {
                debug('Configuration changes detected, diff follows');
                debug(jsdiff.createPatch(configurationFile, originalConfig, newConfig, 'previous', 'new'));
                fs.writeFileSync(configurationFile, newConfig, 'utf8');
                debug('Configuration file updated filename=%s', configurationFile);
                if (reload) {
                    debug('Configuration changes were detected reloading the HAProxy');
                    haproxy.reload(function (err, reloaded, cmd) {
                        if (err) {
                            console.log("HAProxy reload failed error=%s cmd=%s", err, cmd);
                            return reject(err);
                        }
                        debug('Triggered configuration reload reloaded=%s cmd=%s', reloaded, cmd);
                        resolve();
                    });
                } else {
                    debug('Configuration changes were detected but reload is not requested');
                    resolve();
                }
            } else {
                debug('No configuration changes detected');
            }
        });
    });
}


/**
 * Promise that schedule refresh of the HAProxy config
 *
 * @returns {Promise}
 */
var scheduleRefresh = () => new Promise(function (resolve) {
    setInterval(function () {
        try {
            debug('Starting refresh cycle');
            regenerateConfiguration(true)
                .then(()=> debug('Refresh cycle completed successfully'))
                .catch(onFailure);
        } catch (error) {
            onFailure(error);
        }
    }, CONFIG_REFRESH_TIMEOUT_MILLS);
    resolve();
});

/**
 * Promise that will be executed on after all is done
 *
 * @returns {Promise}
 */
function reportSuccess() {
    return new Promise(function (resolve) {
        console.log('HAProxy and configuration script successfully started');
        resolve();
    });
}

/**
 * Failure handler
 * @param error
 */
function onFailure(error) {
    console.log('Failure happened in the process of configuration', error);
    process.exit(-1);
}

// Main sequence
regenerateConfiguration(false)
    .then(verifyConfiguration())
    .then(startHAProxy)
    .then(scheduleRefresh)
    .then(reportSuccess)
    .then(logStats)
    .catch(onFailure);

setTimeout(function () {
    haproxy.reload(console.log);
}, 5000);


setTimeout(function () {
    process.exit(0);
}, 10000);
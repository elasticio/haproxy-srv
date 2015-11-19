var dns = require('dns');
process.env.DEBUG = 'configurator';
var debug = require('debug')('configurator');
var child_process = require('child_process');
var HAProxy = require('haproxy');
var Mark = require("markup-js");
var fs = require("fs");
var jsdiff = require('diff');

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
 * Promise that will do the configuration refresh of the HAProxy (if required)
 *
 * @returns {Promise}
 */
var regenerateConfiguration = () => new Promise(function (resolve, reject) {
    var originalConfig = fs.existsSync(configurationFile) ? fs.readFileSync(configurationFile, 'utf8') : '';
    var template = fs.readFileSync(__dirname + "/haproxy.cfg.template", "utf8");
    var context = {};
    debug('Merging template with context=%j', context);
    var newConfig = Mark.up(template, context);
    var diff = jsdiff.diffTrimmedLines(originalConfig, newConfig, { ignoreWhitespace : true });
    if (diff.length > 1) {
        debug('Configuration changes detected');
        debug(jsdiff.createPatch(configurationFile, originalConfig, newConfig, 'previous', 'new'));
    } else {
        debug('No configuration changes detected');
    }
    resolve();
});


/**
 * Promise that schedule refresh of the HAProxy config
 *
 * @returns {Promise}
 */
var scheduleRefresh = () => new Promise(function (resolve) {
    setInterval(function () {
        debug('Starting refresh cycle');
        regenerateConfiguration()
            .then(()=> debug('Refresh cycle completed successfully'))
            .catch(onFailure);
    }, 1000);
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
regenerateConfiguration()
    .then(verifyConfiguration())
    .then(startHAProxy)
    .then(scheduleRefresh)
    .then(reportSuccess)
    .then(logStats)
    .catch(onFailure);

setTimeout(function() {
    process.exit(0);
}, 10000);

//console.log('CONFIG_SCRIPT: Starting HAProxy monitoring and configuration script');
//
//var childProccess = child_process.spawn('haproxy', ["-f", "/usr/local/etc/haproxy/haproxy.cfg"], {
//    stdio : 'inherit'
//});
//
//childProccess.on('exit', function(code, signal) {
//    console.log('CONFIG_SCRIPT: HAProxy process exited code=%s signal=%s', code, signal);
//    process.exit(code);
//});
//
//var haproxy = new HAProxy('/tmp/haproxy.sock', {
//    config: "/usr/local/etc/haproxy/haproxy.cfg",
//    socket: "/tmp/haproxy.sock"
//});
//
//setInterval(function() {
//    var haproxy = new HAProxy('/tmp/haproxy.sock');
//
//    haproxy.verify(function (err, working) {
//        console.log('HAProxy is working=%s', working, err);
//    });
//}, 1000);

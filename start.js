var dns = require('dns');
var debug = require('debug')('configurator');
var child_process = require('child_process');
var HAProxy = require('haproxy');

var configurationFile = "/usr/local/etc/haproxy/haproxy.cfg";

var haproxy = new HAProxy('/tmp/haproxy.sock', {
    config: "/usr/local/etc/haproxy/haproxy.cfg",
    socket: "/tmp/haproxy.sock"
});

var verifyConfiguration = new Promise(function (resolve, reject) {
    console.log('Verifying configuration');
    haproxy.verify(function(err, working) {
        if (err) {
            return reject(err);
        }
        if (!working) {
            return reject('Configuration is not in the working state');
        }
        console.log('Configuration verified successfully');
        resolve();
    });
});

var startHAProxy = new Promise(function(resolve, reject) {
    console.log('Starting HAProxy daemon');
    haproxy.start(function(err) {
        if (err) return reject(err);
        console.log('HAProxy successfully started');
        resolve();
    });
});

verifyConfiguration.then(startHAProxy).catch(console.error);

setInterval(function() {
    haproxy.stat('-1', '-1', '-1', function (err, stats) {
        console.log(stats);
    });
}, 1000)
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

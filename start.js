var dns = require('dns');
var debug = require('debug')('configurator');
var child_process = require('child_process');


console.log('CONFIG_SCRIPT: Starting HAProxy monitoring and configuration script');

var childProccess = child_process.spawn('haproxy', ["-f", "/usr/local/etc/haproxy/haproxy.cfg"], {
    stdio : 'inherit'
});

childProccess.on('exit', function(code, signal) {
    console.log('CONFIG_SCRIPT: HAProxy process exited code=%s signal=%s', code, signal);
    process.exit(code);
});

//dns.resolveSrv('www.google.com', function onLookup(err, addresses, family) {
//    console.log('addresses:', addresses);
//});
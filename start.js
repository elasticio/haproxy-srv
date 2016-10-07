// Enable info by default
process.env.DEBUG = (process.env.DEBUG ? process.env.DEBUG + ',' : '') + 'configurator:info';
var dns = require('dns');
var debug = require('debug')('configurator:debug');
var info = require('debug')('configurator:info');
var child_process = require('child_process');
var HAProxy = require('haproxy');
var handlebars = require('handlebars');
var fs = require("fs");
var jsdiff = require('diff');
var RSVP = require('rsvp');
var ip = require('ip');

const CONFIG_REFRESH_TIMEOUT_MILLS = "1000" || process.env.REFRESH_TIMEOUT;

var configurationFile = "/etc/haproxy.cfg";

var haproxy = new HAProxy({
    config: configurationFile,
    socket: "/tmp/haproxy.sock"
});

/**
 * Cache that is used for discovery of the required properties
 * and storage of the data used by handlebar helper
 *
 * @type {Map}
 */
var dnsCache = {
    srv: new Map(),
    a: new Map()
};

/**
 * Here we will store result of handlebars.compile()
 */
var template;

var haproxyRunning = false;

/**
 * Promise that will verify configuration
 *
 * @type {Promise}
 */
var verifyConfiguration = () => new Promise(function (resolve, reject) {
    info('Verifying configuration');
    if (!fs.existsSync(configurationFile)) return reject('Configuration file can not be found file=' + configurationFile);
    haproxy.verify(function (err, working) {
        if (err) {
            return reject(err);
        }
        if (!working) {
            info('Configuration have warnings');
        } else {
            info('Configuration verified successfully');
        }
        resolve();
    });
});

/**
 * Promise that will start the HAProxy child process
 * @type {Promise}
 */
var startHAProxy = () => new Promise(function (resolve, reject) {
    info('Starting the HAPRoxy daemon process');
    haproxy.start(function started(err) {
        if (err) {
            console.error('Failed to start the HAProxy process');
            return reject(err)
        }
        haproxyRunning = true;
        resolve();
    });
});

/**
 * This function returns a promise that transforms this
 *
 *  {"name":"api-42873-s1.marathon.mesos","port":8090,"priority":0,"weight":0}
 *
 * into
 *
 *  {"name":"api-42873-s1.marathon.mesos","ip":"10.0.0.2","port":8090,"priority":0,"weight":0}
 *
 * @type {Promise}
 */
var resolveIP = entry => new Promise((resolve, reject) => {
    var name = entry.name;
    if (ip.isV4Format(name) || ip.isV6Format(name)) {
        entry.ip = name;
        debug('Added IP information to the entry entry=%j', entry);
        resolve(entry)
    } else {
        dns.resolve(name, function (err, address) {
            if (err) {
                debug('DNS Lookup failed entry=%s error=%j', name, err);
                return reject(err);
            }
            debug('DNS Lookup succeeded entry=%s address=%s', name, address);
            entry.ip = address[0];
            debug('Added IP information to the entry entry=%j', entry);
            resolve(entry);
        });
    }
});

/** 
 * This function returns a promise that transforms
 *    {"ip": "192.168.1.1" }
 * into
 *    {"ip": "192.168.1.1", "name": "server1.example.com"}
 *
 * @type {Promise}
 */
var reverseLookup = entry => new Promise((resolve, reject) => {
  if ( ! ( ip.isV4Format(entry.ip) && ip.isV6Format(entry.ip) ) )
    return reject("Invalid entry address format");
  
  dns.reverse(entry.ip, function (err, hostnames) {
    if (err) {
      debug("DNS Reverse lookup failed for %j: %j", entry, err);
      return reject(err);
    }
    debug("DNS Reverse lookup succeeded: %j => %j", entry, hostnames);
    // pick the first one
    entry.name = hostnames[0];
    resolve( entry );
  });
});
/** 
 * This function returns a promise that resolves the string 
 * as an array of IP addresess for multiple A records
 *
 * @param dnsName
 * @returns {Promise}
 */
var resolveA = dnsName => new Promise((resolve, reject) => {
  debug("resolveA: doing DNS lookup for %s", dnsName);
  dns.resolve(dnsName, function (err, addresses) {
    if (err) {
        debug('DNS Lookup failed entry=%s error=%j', dnsName, err);
        return reject(err);
    }
    if ( addresses.length == 0 )
      return resolve([]);
    
    // sort IP addresses
    addresses.sort();
    
    debug('DNS Lookup succeeded entry=%s address=%j', dnsName, addresses);
    /* map the address array into something that looks similar
     * to the resolveSRV return
     */
    addresses = addresses.map(function(a) { return {'ip': a } });
    
    // add a 'name' key using reverseLookup
    Promise.all(addresses.map(reverseLookup))
      .then(resolved => resolve(resolved))
      .catch(error => reject(error));
  });
});

/**
 * This function returns a promise that resolve the string as SRV DNS Name
 *
 * @param dnsName
 * @returns {Promise}
 */
var resolveSRV = dnsName => new Promise((resolve, reject) => {
    debug('Sending SRV request for entry=%s', dnsName);
    dns.resolveSrv(dnsName, function (err, result) {
        if (err) {
            debug('DNS SRV record failed to be resolved entry=%s error=', dnsName, err);
            return reject(err);
        }
        debug('DNS Name SRV resolved entry=%s resolved=%j', dnsName, result);
        if (result.length > 0) {
            // Sort items by name to make sure we do not detect false changes
            result = result.sort((a,b) => a.name.localeCompare(b.name));
            Promise.all(result.map(resolveIP))
                .then(resolved => resolve(resolved))
                .catch(error => reject(error));
        } else {
            resolve([]);
        }
    });
});


/**
 * Function that retuns a promise that will resolve into the context
 * for template rendering
 *
 * @returns {Promise}
 */
function generateContext() {
    var services = dnsCache.srv;
    var a_records = dnsCache.a;
    var promises = {};
    services.forEach((value, dnsName) => promises[dnsName] = resolveSRV(dnsName));
    a_records.forEach((value, dnsName) => promises[dnsName] = resolveA(dnsName));
    
    debug('Starting DNS lookups for keys=%j', Object.keys(promises));
    return RSVP.hashSettled(promises).then(function (result) {
        debug('DNS lookup completed');
        var context = {};
        Object.keys(result).map(key => {
            var promiseResult = result[key];
            if (promiseResult && promiseResult.state === 'fulfilled') {
              // A record lookups do not have ports
              if ( typeof(promiseResult.value[0]['port']) == "undefined" )
                a_records.set(key, promiseResult.value);
              else
                services.set(key, promiseResult.value);
            } else {
                // Set key as undefined but do not delete it
                services.set(key);
                a_records.set(key);
            }
        });
        return context;
    });
}

/**
 * This function will do a dry run of the template to see which DNS records we need and validate HBS template syntax
 * @param template
 */
function checkTemplate() {
    var templateSource = fs.readFileSync(__dirname + "/haproxy.cfg.template", "utf8");
    template = handlebars.compile(templateSource);

    // Validate configuration and gather required SRV records
    // we need to do that because hanlebars does not support async helpers
    // we will do the first dry-run to see which DNS records we need
    // then fetch them and will be using them later
    debug('Doing the template dry-run to gather dns values')
    // That's a dry-run helper
    handlebars.registerHelper({
      'dns-srv': function gatherDataHelper(dnsName) {
        debug('Found dns-srv helper with parameter=%s', dnsName);
        dnsCache.srv.set(dnsName);
      },
      'dns-a': function gatherDataHelper(dnsName) {
        debug('Found dns-a helper with parameter=%s', dnsName);
        dnsCache.a.set(dnsName);
      }
    });
    
    // Run!
    template();
    debug('Dry-run completed, found values records srv=%s a=%s', dnsCache.srv.size, dnsCache.a.size);
    // Restoring the dns-srv helper to it's productive state
    handlebars.registerHelper({
      'dns-srv': function gatherDataHelper(dnsName, options) {
        debug('Looking-up dns-srv value dnsName=%s', dnsName);
        var map = dnsCache.srv;
        if (!map.get(dnsName)) {
            debug('DNS-SRV value was not found, block will be ignored dnsName=%s', dnsName);
        } else {
            return options.fn(map.get(dnsName));
        }
      },
      'dns-a':  function gatherDataHelper(dnsName, options) {
        debug('Looking-up dns-a value dnsName=%s', dnsName);
        var map = dnsCache.a;
        if (!map.get(dnsName)) {
            debug('DNS-A value was not found, block will be ignored dnsName=%s', dnsName);
        } else {
            return options.fn(map.get(dnsName));
        }
        
      }
    });
    return Promise.resolve(dnsCache);
}

/**
 * Promise that will do the configuration refresh of the HAProxy (if required)
 *
 * @param reload - if true and configuration changed HAProxy config reload will be triggered
 * @returns {Promise}
 */
function regenerateConfiguration() {
    return generateContext().then(function (context) {
        return new Promise(function (resolve, reject) {
            var originalConfig = fs.existsSync(configurationFile) ? fs.readFileSync(configurationFile, 'utf8') : '';
            debug('Merging template');
            var newConfig = template(context);
            var diff = jsdiff.diffTrimmedLines(originalConfig, newConfig, {ignoreWhitespace: true});
            if (diff.length > 1 || (diff[0].added || diff[0].removed)) {
                info('Configuration changes detected, diff follows');
                info(jsdiff.createPatch(configurationFile, originalConfig, newConfig, 'previous', 'new'));
                info('Writing configuration file filename=%s', configurationFile);
                ;
                fs.writeFileSync(configurationFile, newConfig, 'utf8');
                info('Configuration file updated filename=%s', configurationFile);
                if (haproxyRunning) {
                    info('Configuration changes were detected reloading the HAProxy');
                    haproxy.reload(function (err, reloaded, cmd) {
                        if (err) {
                            info("HAProxy reload failed error=%s cmd=%s", err, cmd);
                            return reject(err);
                        }
                        info('Triggered configuration reload reloaded=%s cmd=%s', reloaded, cmd);
                        resolve();
                    });
                } else {
                    info('Configuration changes were detected but HAProxy is not running yet');
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
        info('HAProxy and configuration script successfully started');
        resolve();
    });
}

/**
 * Failure handler
 * @param error
 */
function onFailure(error) {
    console.error('Failure happened in the process of configuration', error);
    process.exit(-1);
}

// Main sequence
checkTemplate()
    .then(regenerateConfiguration)
    .then(verifyConfiguration)
    .then(startHAProxy)
    .then(scheduleRefresh)
    .then(reportSuccess)
    .catch(onFailure);

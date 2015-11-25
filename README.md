# HAProxy SRV

HAProxy-SRV is a templating solution that can flexibly reconfigure HAProxy based on the regular polling of the
service data from DNS (e.g. SkyDNS or Mesos-DNS) using SRV records.

It has a very simple logic - HA Proxy is configured based on the Handlebars template that is re-evaluated every time changes in DNS are detecting. Script is polling DNS and trigger a HA Proxy configuration refresh after changes.

# How it works

Script works very simple - after docker container started script parse and validates template, create a HAProxy configuration file in ``/src/haproxy.cfg`` and start HAProxy as a daemon. Every second (by default, can be configured via ``REFRESH_TIMEOUT`` env variable, default 1000) scirpt will execute a DNS lookup and re-evaluate the template, if result of evaluation is different from original configuration, original config will be overwritten and HAProxy reload will be triggered. HAProxy reload will not affect existing connections.

# How to use it

Recommended way to deploy is is to use [a Docker image](https://hub.docker.com/r/elasticio/haproxy-srv/). You would need to place your configuration file template, the simples way to do it is to build an image based on ``haproxy-srv`` image. 

Create a new ``Dockerfile`` content like this:

```
FROM elasticio/haproxy-srv:latest

COPY haproxy.cfg.template /src/

EXPOSE 80 8880
```

Note the ``EXPOSE`` part here, don't forget to specify exposed ports if your HAProxy configuration listens on any port different from ``80``.

As a next step create a template file, it should be placed under ``/src/haproxy.cfg.template`` in resulting Docker container and should have a [Handlebars](http://handlebarsjs.com/) syntax with one little extension (see below). Here is the sample:

```hbs
global
    user root
    group root

    # Default SSL material locations
    ca-base /etc/ssl/certs
    crt-base /etc/ssl/private

    # Default ciphers to use on SSL-enabled listening sockets.
    # For more information, see ciphers(1SSL).
    ssl-default-bind-ciphers kEECDH+aRSA+AES:kRSA+AES:+AES256:RC4-SHA:!kEDH:!LOW:!EXP:!MD5:!aNULL:!eNULL

    # Stats required for this module to work
    # https://github.com/observing/haproxy#haproxycfg
    stats socket /tmp/haproxy.sock level admin

defaults
    mode    http
    timeout connect 5000
    timeout client  50000
    timeout server  50000


frontend stats
    bind 0.0.0.0:8081
    mode http
    stats enable
    stats hide-version
    stats uri /

{{#dns-srv "_frontend._tcp.marathon.mesos"}}
    frontend sample
        bind 0.0.0.0:8080
        mode http
        balance roundrobin
        option http-server-close
        option forwardfor
        {{#each this}}
            server frontend-{{@index}} {{ip}}:{{port}} check weight {{weight}}
        {{/each}}
{{/dns-srv}}
```

It could be any valid HAProxy configuration with one mandatory addition:

```
stats socket /tmp/haproxy.sock level admin
```

to trigger HAProxy restart the script inside the file will communicate with HAProxy daemon via socket ```/tmp/haproxy.sock```.

# Template

Configuration template is a normal [Handlebars](http://handlebarsjs.com/) so that you could use any of the feature of this template language. There is however one additional helper ``dns-srv`` implemented. This helper takes one string parameter and will execute a [DNS SRV lookup](https://nodejs.org/api/dns.html#dns_dns_resolvesrv_hostname_callback) to fetch an SRV record(s). After SRV Record lookup, for each SRV record a [DNS resolution](https://nodejs.org/api/dns.html#dns_dns_resolve_hostname_rrtype_callback) to find the IP will be made.

This template will give you an idea how to use it:

```hbs
...
# Your usual configuration is here
{{#dns-srv "_frontend._tcp.marathon.mesos"}}
    # This blog will only be rendered when _frontend._tcp.marathon.mesos was found in DNS
    {{#each this}}
        # This piece will be rendered for each SRV entry from DNS
        SRV Name is {{name}}
        SRV Weight is {{weight}}
        SRV Port is {{port}}
        IP for SRV Name is {{ip}}
    {{/each}}
{{/dns-srv}}
# rest of your configuration
```

Typical use-case for Msos-DNS you can see above.

# Debugging

Just set the ``DEBUG`` environment variable into ``*`` to see detailed logging.

# TODOs

PRs are welcome for
 * Bug fixes
 * Unit tests
 * Gulp or Grunt-based builds
 * CircleCI config for continous integration

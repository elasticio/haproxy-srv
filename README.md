# HAProxy SRV

HAProxy-SRV is a templating solution that can flexibly reconfigure HAProxy based on the regular polling of the
service data from DNS (e.g. SkyDNS or Mesos-DNS) using SRV records.

It has a very simple logic - HA Proxy is configured based on the Handlebars template that is re-evaluated every time changes in DNS are detecting. Script is polling DNS and trigger a HA Proxy configuration refresh after changes.

# How to use it

Recommended way to deploy is is to use [a Docker image](https://hub.docker.com/r/elasticio/haproxy-srv/). You would need to place your configuration file template, the simples way to do it is to build an image based on ``haproxy-srv`` image. 

Create a new ``Dockerfile`` content like this:

```
FROM elasticio/haproxy-srv:latest

COPY haproxy.cfg.template /src/

EXPOSE 80 4022
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

# Debugging

Just set the ``DEBUG`` environment variable into ``*`` to see detailed logging.


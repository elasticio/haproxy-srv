# HAProxy SRV

HAProxy-SRV is a templating solution that can flexibly reconfigure HAProxy based on the regular polling of the
service data from DNS (e.g. SkyDNS or Mesos-DNS) using SRV records.

HAProxy-SRV also works with Round-Robin DNS A records, like Docker Swarm Mode.

It has a very simple logic - HA Proxy is configured based on the Handlebars template that is re-evaluated every time changes in DNS are detecting. Script is polling DNS and trigger a HA Proxy configuration refresh after changes.

Made by [elastic.io](http://www.elastic.io) in Germany.

# Quick start

Simplest way to start it with Docker:

```
docker run -d -p 8080:8080 -p 80:80 -v $PWD/haproxy.cfg.template:/src/haproxy.cfg.template elasticio/haproxy-srv:latest
```

if you want to see more DEBUG output then just add ``-e "DEBUG=*"``

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

    # Stats required for this module to work
    # https://github.com/observing/haproxy#haproxycfg
    stats socket /tmp/haproxy.sock level admin

defaults
    mode    http
    timeout connect 5000
    timeout client  50000
    timeout server  50000

{{#dns-srv "_frontend._tcp.marathon.mesos"}}
    frontend sample
        bind 0.0.0.0:80
        balance roundrobin
        option http-server-close
        option forwardfor
        {{#each this}}
            server frontend-{{@index}} {{ip}}:{{port}} check weight {{weight}}
        {{/each}}
{{/dns-srv}}

# Standard DNS Round-Robin
{{#dns-a "cluster.example.com"}}
  frontend sample2
    bind 0.0.0.0:8080
    {{#each this}}
      server {{name}} {{ip}}:80 check
    {{/each}}
{{/dns-a}}

# Docker Swarm Mode example
{{#dns-a "tasks.myservice"}}
  frontend sample3
    bind 0.0.0.0:8081
    {{#each this}}
      server {{name}} {{ip}}:80 check
    {{/each}}
{{/dns-a}}
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
# Your usual configuration is here
{{#dns-srv "_frontend._tcp.marathon.mesos"}}
    # This block will only be rendered when _frontend._tcp.marathon.mesos was found in DNS
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

# Docker Swarm Mode Guide

First, create a network, and web service:

```
$ docker network create -d overlay --subnet 10.1.1.0/24 my_net
$ docker service create --replicas 2 --name my_web --network my_net nginx
```

By default, services are created as `--endpoint-mode vip`.  If you use VIP mode,
then the Round-Robin DNS name is `tasks.my_web`.  If you use `--endpoint-mode dnsrr`
then the `my_web` DNS name will work in the HAProxy `dns-a` template.

Follow the **How to use it** section above on creating a new proxy image using
a custom haproxy.cfg.template.  For the `dns-a` section use:

```
{{#dns-a "tasks.my_web"}}
  # other configs
  backend my_web
  {{#each this}}
    server {{name}} {{ip}}:80 check
  {{/each}}
{{/dns-a}}
```

```
$ mkdir my_proxy ; cd my_proxy
#  (make a new Dockerfile)
$ docker build -t my_proxy_image .
```

Fire up a new proxy, publishing port 80 to something unique on each docker host node

```
$ docker service create --name my_proxy --network my_net -p 8081:80 my_proxy_image
```

Optionally, use some other method for sharing & binding the haproxy.cfg.template file
into the `elasticio/haproxy-srv` image.

# Debugging

Just set the ``DEBUG`` environment variable into ``*`` to see detailed logging.

# TODOs

PRs are welcome for
 * Bug fixes
 * Unit tests
 * Gulp or Grunt-based builds
 * CircleCI config for continous integration

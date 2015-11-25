# HAProxy SRV

HAProxy-SRV is a templating solution that can flexibly reconfigure HAProxy based on the regular polling of the
service data from DNS (e.g. SkyDNS or Mesos-DNS) using SRV records.

It has a very simple logic - HA Proxy is configured based on the Handlebars template that is re-evaluated every time changes in DNS are detecting. Script is polling DNS and trigger a HA Proxy configuration refresh after changes.

# Installation

Recommended way to deploy is is to use [a Docker image](https://hub.docker.com/r/elasticio/haproxy-srv/). You would need to place your configuration file template, the simples way to do it is to build an image based on ``haproxy-srv`` image. 

Create a new ``Dockerfile`` content like this:

```
FROM elasticio/haproxy-srv:latest

COPY haproxy.cfg.template /src/

EXPOSE 80 4022
```

Note the ``EXPOSE`` part here, don't forget to specify exposed ports if your HAProxy configuration listens on any port different from ``80``.


# Debugging


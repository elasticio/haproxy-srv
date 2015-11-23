# HAProxy SRV

HAProxy-SRV is a templating solution that can flexibly reconfigure HAProxy based on the regular polling of the
service data from DNS (e.g. SkyDNS or Mesos-DNS) using SRV records.

It has a very simple logic - HA Proxy is configured based on the Handlebars template that is re-evaluated every time changes in DNS are detecting. Script is polling DNS and re-load HA Proxy configuration.

# Docker image

Recommended way to deploy is is to use a Docker image, see the https://hub.docker.com/r/elasticio/haproxy-srv/

# Debugging


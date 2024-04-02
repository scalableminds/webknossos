# Deployment

## Requirements
* Linux (we have good experiences with Ubuntu and Debian, but others should work as well)
* a recent versions of docker & docker-compose
* Public domain name with SSL certificate

## Prepare file system
WEBKNOSSOS expects the following file structure:
```
docker-compose.yml
fossildb/
    data/
    backup/
config/
tmp/
```
Ensure that all those directories have the correct access rights.

## Add the `deployment` files
Copy the files from the `deployment` folder to `/usr/lib/webknossos-tracingstore` and customize the files in the `config` subfolder.

## Manage the webknossos-tracingstore service
Depending on you Linux distribution, the service unit file should be linked to `/lib/systemd/system/webknossos-tracingstore.service` or `/usr/lib/systemd/system/webknossos-tracingstore.service`.
Usage:

```
# Reload configuration
systemctl daemon-reload

# Enable for auto-start
systemctl enable webknossos-tracingstore

systemctl start webknossos-tracingstore

systemctl stop webknossos-tracingstore
```

## Using a cluster proxy/firewall for HTTP(S) routing
If your cluster environment has a firewall that supports HTTP(S) routing, you can expose the tracingstore directly on Port 80.

## Using nginx for HTTP(S) routing
Nginx is a high performance HTTP server that allows for proxying HTTP(S) request. This is useful, because the tracingstore doesn't support HTTPS by itself. So, you can put the nginx in front of the tracingstore to accept HTTPS requests from the outside and route them as regular HTTP requests to the tracingstore.

[DigitalOcean has a great tutorial for setting up nginx](https://www.digitalocean.com/community/tutorials/understanding-nginx-http-proxying-load-balancing-buffering-and-caching).

We use the free and automatad [Letsencrypt](https://letsencrypt.org/) service for our SSL certificates. [Tutorial: Setting up Letsencrypt with nginx](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-16-04).

Example configuration:
```
upstream webknossos-tracingstore-0 {
  server localhost:9090;
}

server {
  listen 80;
  listen [::]:80;
  server_name tracingstore-0.mylab.com;

  # For Letsencrypt
  location ~ /.well-known/ {
    root /usr/share/nginx/html;
    allow all;
    break;
  }

  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name  tracingstore-0.mylab.com;

  access_log  /var/log/nginx/tracingstore-0.mylab.com.access.log;
  error_log   /var/log/nginx/tracingstore-0.mylab.com.error.log debug;
  rewrite_log on;

  # For Letsencrypt
  location ~ /.well-known/ {
    root /usr/share/nginx/html;
    allow all;
  }

  ssl                 on;
  ssl_certificate     /etc/letsencrypt/live/tracingstore-0.mylab.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/tracingstore-0.mylab.com/privkey.pem;
  ssl_protocols       SSLv3 TLSv1 TLSv1.1 TLSv1.2;
  ssl_ciphers         HIGH:!aNULL:!MD5;

  client_max_body_size 0;

  location / {
    proxy_pass http://webknossos-tracingstore-0;
  }
}
```

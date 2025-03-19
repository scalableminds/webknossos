# Deployment

## Requirements
* Linux (we have good experiences with Ubuntu and Debian, but others should work as well)
* a recent versions of docker & docker-compose
* Public domain name with SSL certificate

## Prepare file system
WEBKNOSSOS expects the following file structure:
```
docker-compose.yml
binaryData/ # path can be specified in config/environment
    <Team name>/
        <Dataset 1>/ # Can be converted from image stack with webknossos-cuber
            color/
                1 # mag1
                2 # mag2
                4 # mag4
                ...
        ...
config/
tmp/
```
Ensure that all those directories have the correct access rights.

## Add the `deployment` files
Copy the files from the `deployment` folder to `/usr/lib/webknossos-datastore` and customize the files in the `config` subfolder.

## Manage the webknossos-datastore service
Depending on you Linux distribution, the service unit file should be linked to `/lib/systemd/system/webknossos-datastore.service` or `/usr/lib/systemd/system/webknossos-datastore.service`.
Usage:

```
# Reload configuration
systemctl daemon-reload

# Enable for auto-start
systemctl enable webknossos-datastore

systemctl start webknossos-datastore

systemctl stop webknossos-datastore
```

## Using a cluster proxy/firewall for HTTP(S) routing
If your cluster environment has a firewall that supports HTTP(S) routing, you can expose the datastore directly on Port 80.

## Using nginx for HTTP(S) routing
Nginx is a high performance HTTP server that allows for proxing HTTP(S) request. This is useful, because the datastore doesn't support HTTPS by itself. So, you can put the nginx in front of the datastore to accept HTTPS requests from the outside and route them as regular HTTP requests to the datastore.

[DigitalOcean has a great tutorial for setting up nginx](https://www.digitalocean.com/community/tutorials/understanding-nginx-http-proxying-load-balancing-buffering-and-caching).

We use the free and automatad [Letsencrypt](https://letsencrypt.org/) service for our SSL certificates. [Tutorial: Setting up Letsencrypt with nginx](https://www.digitalocean.com/community/tutorials/how-to-secure-nginx-with-let-s-encrypt-on-ubuntu-16-04).

Example configuration:
```
upstream webknossos-datastore-0 {
  server localhost:9090;
}

server {
  listen 80;
  listen [::]:80;
  server_name datastore-0.mylab.com;

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
  server_name  datastore-0.mylab.com;

  access_log  /var/log/nginx/datastore-0.mylab.com.access.log;
  error_log   /var/log/nginx/datastore-0.mylab.com.error.log debug;
  rewrite_log on;

  # For Letsencrypt
  location ~ /.well-known/ {
    root /usr/share/nginx/html;
    allow all;
  }

  ssl                 on;
  ssl_certificate     /etc/letsencrypt/live/datastore-0.mylab.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/datastore-0.mylab.com/privkey.pem;
  ssl_protocols       SSLv3 TLSv1 TLSv1.1 TLSv1.2;
  ssl_ciphers         HIGH:!aNULL:!MD5;

  client_max_body_size 0;

  location / {
    proxy_pass http://webknossos-datastore-0;
  }
}
```

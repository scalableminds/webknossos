# webknossos-datastore
Datastore component for webKnossos intended for deployment on storage servers.

## Deploy webknossos-datastore with Docker

### Requirements
* Linux (we have good experiences with Ubuntu and Debian, but others should work as well)
* Docker 1.12+
* Public domain name with SSL certificate

### Prepare file system
webKnossos expects the following file structure:
```
binaryData/ # Needs to be writable by docker user (uid=1000 gid=1000)
    <Team name>/ 
        <Dataset 1>/ # Can be converted from image stack with webknossos-cuber
            color/
                layer.json
                1 # mag1
                2 # mag2
                4 # mag4
                ...
            settings.json
        ...
userBinaryData/ # Needs to be writable by docker user (uid=1000 gid=1000)
```

### Configure datastore
Create a config file `docker.conf` like this:
```
include "application.conf"

http.uri = "<public datastore uri, e.g. https://datastore-0.mylab.com"
datastore {
  name = "<unique datastore name, e.g. datastore-mylab-0>"
  key = "<secret key>"
  oxalis {
    uri = "<webknossos uri, e.g. demo.webknossos.org>"
    secured = true
  }
}

braingames.binary.cacheMaxSize = 1000 # in entries (each cache entry is 2 MB)
```

### Create and run Docker container
```
docker create \
  --name webknossos-datastore \
  -v /path/to/binaryData:/srv/webknossos-datastore/binaryData \
  -v /path/to/userBinaryData:/srv/webknossos-datastore/userBinaryData \
  -v /path/to/docker.conf:/srv/webknossos-datastore/conf/docker.conf \
  -p 9090:9090 \
  scalableminds/webknossos-datastore:master \
  -J-Xmx10G \
  -J-Xms1G \
  -Dhttp.port=9090 \
  -Dlogger.file=conf/logback-docker.xml \
  -Dconfig.file=conf/docker.conf \
  -Djava.io.tmpdir=disk

docker start webknossos-datastore

docker stop webknossos-datastore

docker rm webknossos-datastore
```

### Host integration (systemd)
To have the datastore automatically start upon boot, you need to create a systemd unit file:
```
[Unit]
Description=webKnossos datastore
Requires=docker.service
After=docker.service

[Service]
Restart=always
ExecStart=/usr/bin/docker start -a webknossos-datastore
ExecStop=/usr/bin/docker stop -t 2 webknossos-datastore

[Install]
WantedBy=default.target
```
Depending on you Linux distribution, the unit file should be stored in `/lib/systemd/system/webknossos-datastore.service` or `/usr/lib/systemd/system/webknossos-datastore.service`.

```
# Reload configuration
systemctl daemon-reload

# Enable for auto-start
systemctl enable webknossos-datastore

systemctl start webknossos-datastore

systemctl stop webknossos-datastore
```

### Modify the user inside the docker container
By default the datastore runs with a Linux user account that has uid=1000 and gid=1000. If your setup requires a different user, e.g. because of file permissions, you may add the user flag to your docker create command `-u <uid>:<gid>`. You can find the uid and gid with the Linux `id <username>` command.

### Using a cluster firewall for HTTP(S) routing
If your cluster enviroment has a firewall that supports HTTP(S) routing, you can expose the datastore directly on Port 80. For that, change the port flag to `-p 9090:80`

### Using nginx for HTTP(S) routing
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

## License
AGPLv3

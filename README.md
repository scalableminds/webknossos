# webknossos-datastore
Datastore component for webKnossos intended for deployment on storage servers.

## Deploy webknossos-datastore with Docker

### Requirements
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

### Create and run Docker image
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
You may want to create systemd configuration for `docker start/stop`, [reference](https://docs.docker.com/engine/admin/host_integration/).


### Setup a reverse proxy
* Install nginx
* Configure it as a reverse proxy for `localhost:9090`, [reference](https://www.digitalocean.com/community/tutorials/understanding-nginx-http-proxying-load-balancing-buffering-and-caching)

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

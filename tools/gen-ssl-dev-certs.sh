#!/usr/bin/env bash

mkdir -p target/
openssl req -x509 -newkey rsa:2048 \
  -keyout target/dev.key.pem \
  -out target/dev.cert.pem \
  -sha256 -days 365 \
  -nodes \
  -subj "/C=XX/ST=Dev/O=Dev/OU=Dev/CN=webknossos.local"

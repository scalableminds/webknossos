#!/usr/bin/env bash

set -xe

rm -rf frontend/javascripts/test/screenshots/**

docker run --rm \
  -e "URL=$URL" \
  -e "WK_AUTH_TOKEN=$WK_AUTH_TOKEN" \
  -w "/home/pptruser/webknossos" \
  -v ".:/home/pptruser/webknossos" \
  -u "$(id -u):$(id -g)" \
  scalableminds/puppeteer:master bash -c 'for i in {1..3}; do yarn test-screenshot && break; done'

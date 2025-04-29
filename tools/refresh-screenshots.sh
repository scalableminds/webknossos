#!/usr/bin/env bash

set -xe

rm -rf frontend/javascripts/test/screenshots/**

docker run --rm \
  --pull "always" \
  --env "URL=$URL" \
  --env "WK_AUTH_TOKEN=$WK_AUTH_TOKEN" \
  --env "BROWSERSTACK_USERNAME=$BROWSERSTACK_USERNAME" \
  --env "BROWSERSTACK_ACCESS_KEY=$BROWSERSTACK_ACCESS_KEY" \
  --workdir "/home/pptruser/webknossos" \
  --volume ".:/home/pptruser/webknossos" \
  --user "$(id -u):$(id -g)" \
  scalableminds/puppeteer:master bash -c 'for i in {1..3}; do yarn test-screenshot && break; done'

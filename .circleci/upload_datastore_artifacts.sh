#!/usr/bin/env bash
set -eo pipefail

if [[ -n "$CIRCLE_TAG" ]]; then
  GITHUB_TOKEN=ToDo
  JAR_FILE=webknossos-datastore/target/scala-2.12/webknossos-datastore-dev.jar
  SCRIPT_FILE=tools/auto_update/run.sh
  RESPONSE=$(curl \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/scalableminds/webknossos/releases/tags/"$CIRCLE_TAG")

  UPLOAD_URL=$(echo "$RESPONSE" | grep -Po '"upload_url":.*?[^\\]",' | cut -d "\"" -f 4 | cut -d "{" -f 1)

  curl \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Content-Type: $(file -b --mime-type $JAR_FILE)" \
      --data-binary @$JAR_FILE \
      "$UPLOAD_URL?name=webknossos-datastore.jar"

  curl \
      -H "Authorization: token $GITHUB_TOKEN" \
      -H "Content-Type: $(file -b --mime-type $SCRIPT_FILE)" \
      --data-binary @$SCRIPT_FILE \
      "$UPLOAD_URL?name=run.sh"
fi

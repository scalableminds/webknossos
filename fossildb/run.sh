#!/usr/bin/env bash
set -Eeuo pipefail

JAR="fossildb.jar"
VERSION="0.1.1"
FOSSILDB="$(dirname $(readlink -f $0))/$JAR"
URL="https://github.com/scalableminds/fossildb/releases/download/$VERSION/$JAR"

if [ ! -f "$FOSSILDB" ] || [ ! "$(java -jar \"$FOSSILDB\") --version" = "$VERSION" ]; then
  wget -O "$FOSSILDB" "$URL"
fi

exec java -jar "$FOSSILDB" -c skeletons,skeletonUpdates,volumes,volumeData

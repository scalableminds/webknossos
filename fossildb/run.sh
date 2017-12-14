#!/usr/bin/env bash
set -Eeuo pipefail

JAR="fossildb.jar"
VERSION="0.1.1"
FOSSILDB="$(dirname $(readlink -f $0))/$JAR"
URL="https://github.com/scalableminds/fossildb/releases/download/$VERSION/$JAR"
CURRENT_VERSION="$(java -jar "$FOSSILDB" --version || echo "unknown")"

if [ ! -f "$FOSSILDB" ] || [ ! "$CURRENT_VERSION" == "$VERSION" ]; then
  echo "Updating FossilDB version from $CURRENT_VERSION to $VERSION"
  wget -q --show-progress -O "$FOSSILDB" "$URL"
fi

exec java -jar "$FOSSILDB" -c skeletons,skeletonUpdates,volumes,volumeData

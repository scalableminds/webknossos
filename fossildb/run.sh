#!/usr/bin/env bash
set -Eeuo pipefail

FOSSILDB_HOME="$(dirname "$0")"

JAR="$FOSSILDB_HOME/fossildb.jar"
VERSION="$(cat "$FOSSILDB_HOME/version")"
CURRENT_VERSION="$(java -jar "$JAR" --version || true)"
CURRENT_VERSION="${CURRENT_VERSION:-unknown}"
URL="https://github.com/scalableminds/fossildb/releases/download/$VERSION/fossildb.jar"

if [ ! -f "$JAR" ] || [ ! "$CURRENT_VERSION" == "$VERSION" ]; then
  echo "Updating FossilDB version from $CURRENT_VERSION to $VERSION"
  wget -q --show-progress -O "$JAR" "$URL"
fi

COLLECTIONS="skeletons,volumes,volumeData,volumeSegmentIndex,editableMappingsInfo,editableMappingsAgglomerateToGraph,editableMappingsSegmentToAgglomerate,annotations,annotationUpdates"

exec java -jar "$JAR" -c "$COLLECTIONS" -d "$FOSSILDB_HOME/data" -b "$FOSSILDB_HOME/backup"

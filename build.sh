#!/bin/bash
set -e

: ${BRAINGAMES_LIB_VERSION:?"Need non empty BRAINGAMES_LIB_VERSION variable"}

SCALA_BUILD_FILE="project/Build.scala"

sed -i "s/val braingamesVersion = \".*\"/val braingamesVersion = \"$BRAINGAMES_LIB_VERSION\"/" $SCALA_BUILD_FILE

sbt clean compile stage


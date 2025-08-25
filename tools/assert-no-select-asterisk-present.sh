#!/usr/bin/env bash
set -euo pipefail

# Start directory, default to current
START_DIR="${1:-.}"

# Search recursively for *.scala and detect "SELECT *"
echo "🔍 Checking for forbidden 'SELECT *' in Scala files under $START_DIR..."

violations=$(grep -ri --include="*.scala" --exclude-dir="test" "select[[:space:]]*\*" "$START_DIR" || true)

if [[ -n "$violations" ]]; then
  echo "❌  Found forbidden 'SELECT *' usage:"
  echo "$violations"
  exit 1
else
  echo "✅ No 'SELECT *' found."
fi

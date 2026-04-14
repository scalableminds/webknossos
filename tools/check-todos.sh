#!/usr/bin/env bash
set -e

# Files to exclude from the TODO check (paths relative to repo root).
BLACKLIST=(
  .github/PULL_REQUEST_TEMPLATE.md
  .github/workflows/check_todos.yml
  tools/check-todos.sh
  webknossos-datastore/deployment/config/datastore-docker.conf
  webknossos-tracingstore/deployment/config/tracingstore-docker.conf
  docs/images/raw/tracing_ui_overview.svg
  tools/obj_models/obj_parser.py
)

TODOS=$(git grep -niI -E 'todo[a-z]?([ :]|$)' | grep -viE '#[0-9]+' || true)

if [ ${#BLACKLIST[@]} -gt 0 ]; then
  BLACKLIST_PATTERN=$(printf '%s\n' "${BLACKLIST[@]}" | sed 's|[.[\*^$]|\\&|g' | paste -sd'|')
  TODOS=$(echo "$TODOS" | grep -vE "^($BLACKLIST_PATTERN):" || true)
fi
if [ -n "$TODOS" ]; then
  echo "Found TODO comments without a linked issue. Each TODO must reference a GitHub issue number (e.g. '# TODO #1234')."
  echo "Note: If you need a dev build and prefer to keep unlinked TODO comments, convert your PR to a draft PR."
  echo "Note: You can exclude a file path from this check by adding it to the blacklist in check-todos.sh."
  echo ""
  echo "$TODOS"
  exit 1
fi

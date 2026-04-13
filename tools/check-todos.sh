#!/usr/bin/env bash
set -e

TODOS=$(git grep -niI -E 'todo[a-z]?([ :]|$)' | grep -viE '#[0-9]+' || true)
if [ -n "$TODOS" ]; then
  echo "Found TODO comments without a linked issue. Each TODO must reference a GitHub issue number (e.g. '# TODO #1234')."
  echo "Note: If you need a dev build and prefer to keep unlinked TODO comments, convert your PR to a draft PR."
  echo ""
  echo "$TODOS"
  exit 1
fi

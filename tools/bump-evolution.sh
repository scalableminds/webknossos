#!/usr/bin/env bash

# Renumber a branch-local schema evolution to avoid conflicts with upstream.
# Usage: ./tools/bump-evolution.sh
set -euo pipefail

EVOLUTIONS_DIR="schema/evolutions"
SCHEMA_FILE="schema/schema.sql"

# pick the evolution added on this branch that is not in master
BRANCH_FILE=$(git diff master --name-only --diff-filter=A \
  | grep -E "^schema/evolutions/[0-9]+-.*\.sql$" \
  | grep -v "/reversions/" \
  | head -1)
if [[ -z "$BRANCH_FILE" ]]; then
  echo "No new evolution file found in this branch. Pass the old number explicitly." >&2
  exit 1
fi
OLD_NUM=$(basename "$BRANCH_FILE" | grep -oE '^[0-9]+')

OLD_PAD=$(printf "%d" "$OLD_NUM")  # normalised (drops leading zeros beyond single digit)

OLD_FWD=$(basename "$BRANCH_FILE")
if [[ ! -f "$EVOLUTIONS_DIR/$OLD_FWD" ]]; then
  echo "Evolution file '$OLD_FWD' not found in $EVOLUTIONS_DIR" >&2
  exit 1
fi
STEM=${OLD_FWD#${OLD_PAD}-}   # e.g. "job-error-details.sql"

# --- determine the next free number ---
MAX_NUM=$(ls "$EVOLUTIONS_DIR"/*.sql \
  | xargs -I{} basename {} \
  | grep -oE '^[0-9]+' \
  | sort -n \
  | tail -1)
NEW_NUM=$((MAX_NUM + 1))

NEW_FWD="${NEW_NUM}-${STEM}"
NEW_REV="${NEW_NUM}-${STEM}"
OLD_REV_FILE="${OLD_PAD}-${STEM}"
if [[ -f "$EVOLUTIONS_DIR/reversions/$OLD_REV_FILE" ]]; then
  OLD_REV="$OLD_REV_FILE"
else
  OLD_REV=""
fi

echo "Renumbering evolution $OLD_PAD → $NEW_NUM  ($STEM)"

# --- rename files ---
mv "$EVOLUTIONS_DIR/$OLD_FWD" "$EVOLUTIONS_DIR/$NEW_FWD"
echo "  renamed $EVOLUTIONS_DIR/$OLD_FWD → $EVOLUTIONS_DIR/$NEW_FWD"

if [[ -n "$OLD_REV" ]]; then
  mv "$EVOLUTIONS_DIR/reversions/$OLD_REV" "$EVOLUTIONS_DIR/reversions/$NEW_REV"
  echo "  renamed $EVOLUTIONS_DIR/reversions/$OLD_REV → $EVOLUTIONS_DIR/reversions/$NEW_REV"
fi

# --- update version numbers inside the forward evolution ---
PREV_NUM=$((NEW_NUM - 1))
# prerequisite check: old version was OLD_NUM-1
OLD_PREREQ=$((OLD_NUM - 1))
sed -i "s/<> ${OLD_PREREQ} then/<> ${PREV_NUM} then/" "$EVOLUTIONS_DIR/$NEW_FWD"
sed -i "s/SET schemaVersion = ${OLD_NUM}/SET schemaVersion = ${NEW_NUM}/" "$EVOLUTIONS_DIR/$NEW_FWD"
echo "  updated versions in $EVOLUTIONS_DIR/$NEW_FWD"

# --- update version numbers inside the reversion ---
if [[ -n "$OLD_REV" ]]; then
  sed -i "s/<> ${OLD_NUM} then/<> ${NEW_NUM} then/" "$EVOLUTIONS_DIR/reversions/$NEW_REV"
  sed -i "s/SET schemaVersion = ${OLD_PREREQ}/SET schemaVersion = ${PREV_NUM}/" "$EVOLUTIONS_DIR/reversions/$NEW_REV"
  echo "  updated versions in $EVOLUTIONS_DIR/reversions/$NEW_REV"
fi

# --- bump schema.sql ---
sed -i "s/values(${OLD_NUM})/values(${NEW_NUM})/" "$SCHEMA_FILE"
# also handle the case where schema.sql was already at PREV_NUM (not yet bumped)
sed -i "s/values(${PREV_NUM})/values(${NEW_NUM})/" "$SCHEMA_FILE"
echo "  updated schemaVersion in $SCHEMA_FILE"

# --- update unreleased_changes md files ---
MD_FILES=$(grep -rl "${OLD_PAD}-${STEM%.sql}" unreleased_changes/ 2>/dev/null || true)
for f in $MD_FILES; do
  sed -i "s|${OLD_PAD}-${STEM}|${NEW_NUM}-${STEM}|g" "$f"
  echo "  updated reference in $f"
done

echo "Done. Schema version is now $NEW_NUM. Please proofread the Diff!"

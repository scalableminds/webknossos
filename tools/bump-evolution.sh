#!/usr/bin/env bash

# Renumber a branch-local schema evolution to avoid conflicts with upstream.
# Usage: ./tools/bump-evolution.sh
set -euo pipefail

EVOLUTIONS_DIR="schema/evolutions"
SCHEMA_FILE="schema/schema.sql"

# pick the evolution added on this branch that is not in master
BRANCH_FILE=$(git diff master --name-only --diff-filter=A \
  | { grep -E "^schema/evolutions/[0-9]+-.*\.sql$" || true; } \
  | { grep -v "/reversions/" || true; } \
  | head -1)
if [[ -z "$BRANCH_FILE" ]]; then
  echo "No new evolution file found in this branch." >&2
  exit 1
fi
OLD_NUM=$(basename "$BRANCH_FILE" | grep -oE '^[0-9]+')

OLD_PAD=$(printf "%d" "$OLD_NUM")  # normalised (drops leading zeros beyond single digit)

OLD_FORWARD_EVOLUTION=$(basename "$BRANCH_FILE")
if [[ ! -f "$EVOLUTIONS_DIR/$OLD_FORWARD_EVOLUTION" ]]; then
  echo "Evolution file '$OLD_FORWARD_EVOLUTION' not found in $EVOLUTIONS_DIR" >&2
  exit 1
fi
STEM=${OLD_FORWARD_EVOLUTION#${OLD_PAD}-}   # e.g. "job-error-details.sql"

# --- determine the next free number (excluding the branch file itself) ---
MAX_NUM=$(ls "$EVOLUTIONS_DIR"/*.sql \
  | grep -v "/${OLD_FORWARD_EVOLUTION}$" \
  | xargs -I{} basename {} \
  | grep -oE '^[0-9]+' \
  | sort -n \
  | tail -1)
NEW_NUM=$((MAX_NUM + 1))

if [[ "$OLD_NUM" -eq "$NEW_NUM" ]]; then
  echo "Evolution $OLD_NUM is already at the correct number. No changes necessary."
  exit 0
fi

NEW_FORWARD_EVOLUTION="${NEW_NUM}-${STEM}"
NEW_REVERSION="${NEW_NUM}-${STEM}"
OLD_REVERSION_FILE="${OLD_PAD}-${STEM}"
if [[ -f "$EVOLUTIONS_DIR/reversions/$OLD_REVERSION_FILE" ]]; then
  OLD_REVERSION="$OLD_REVERSION_FILE"
else
  OLD_REVERSION=""
fi

echo "Renumbering evolution $OLD_PAD → $NEW_NUM  ($STEM)"

# --- rename files ---
mv "$EVOLUTIONS_DIR/$OLD_FORWARD_EVOLUTION" "$EVOLUTIONS_DIR/$NEW_FORWARD_EVOLUTION"
echo "  renamed $EVOLUTIONS_DIR/$OLD_FORWARD_EVOLUTION → $EVOLUTIONS_DIR/$NEW_FORWARD_EVOLUTION"

if [[ -n "$OLD_REVERSION" ]]; then
  mv "$EVOLUTIONS_DIR/reversions/$OLD_REVERSION" "$EVOLUTIONS_DIR/reversions/$NEW_REVERSION"
  echo "  renamed $EVOLUTIONS_DIR/reversions/$OLD_REVERSION → $EVOLUTIONS_DIR/reversions/$NEW_REVERSION"
fi

# --- update version numbers inside the forward evolution ---
PREV_NUM=$((NEW_NUM - 1))
# prerequisite check: old version was OLD_NUM-1
OLD_PREREQ=$((OLD_NUM - 1))
sed -i "s/<> ${OLD_PREREQ} then/<> ${PREV_NUM} then/" "$EVOLUTIONS_DIR/$NEW_FORWARD_EVOLUTION"
sed -i "s/SET schemaVersion = ${OLD_NUM}/SET schemaVersion = ${NEW_NUM}/" "$EVOLUTIONS_DIR/$NEW_FORWARD_EVOLUTION"
echo "  updated versions in $EVOLUTIONS_DIR/$NEW_FORWARD_EVOLUTION"

# --- update version numbers inside the reversion ---
if [[ -n "$OLD_REVERSION" ]]; then
  sed -i "s/<> ${OLD_NUM} then/<> ${NEW_NUM} then/" "$EVOLUTIONS_DIR/reversions/$NEW_REVERSION"
  sed -i "s/SET schemaVersion = ${OLD_PREREQ}/SET schemaVersion = ${PREV_NUM}/" "$EVOLUTIONS_DIR/reversions/$NEW_REVERSION"
  echo "  updated versions in $EVOLUTIONS_DIR/reversions/$NEW_REVERSION"
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

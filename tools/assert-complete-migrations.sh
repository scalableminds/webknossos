#!/bin/bash
set -euo pipefail

# This script asserts that each migration file in conf/evolutions
# - is mentioned in either MIGRATIONS.released.md or in unreleased_changes/*.md (but not both)
# - has a reversion sibling in conf/evolutions/reversions

EVOLUTIONS_FOLDER="conf/evolutions"
RELEASED_FILE="MIGRATIONS.released.md"
UNRELEASED_DIR="unreleased_changes"

CONTENT_RELEASED=$(cat "$RELEASED_FILE")

exit_code=0

for file in "$EVOLUTIONS_FOLDER"/*; do
    filename=$(basename "$file")

    # Skip the "reversions" directory and initial-schema
    if [[ "$filename" == "reversions" || "$filename" == "000-initial-schema.sql" ]]; then
        continue
    fi

    mentioned_in_released=$([[ "$CONTENT_RELEASED" == *"$filename"* ]] && echo 1 || echo 0)
    mentioned_in_unreleased=$(grep "$filename" "$UNRELEASED_DIR"/*.md >/dev/null 2>&1 && echo 1 || echo 0)

    if (( mentioned_in_released == 1 && mentioned_in_unreleased == 1 )); then
        echo "Conflict: '$filename' is listed in both $RELEASED_FILE and $UNRELEASED_DIR."
        exit_code=1
    elif (( mentioned_in_released == 0 && mentioned_in_unreleased == 0 )); then
        echo "Missing: '$filename' is not listed in $RELEASED_FILE nor $UNRELEASED_DIR."
        exit_code=1
    fi

    if [[ ! -f "$EVOLUTIONS_FOLDER/reversions/$filename" ]]; then
        echo "$filename does not exist in $EVOLUTIONS_FOLDER/reversions/"
        exit_code=1
    fi
done

if (( exit_code == 0 )); then
    echo "Success: All migrations are correctly mentioned in the migration guides and have reversions."
fi

exit $exit_code

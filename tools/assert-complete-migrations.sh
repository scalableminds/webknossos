#!/bin/bash
set -euo pipefail

# This script asserts that each migration file in conf/evolutions
# - is mentioned in either MIGRATIONS.released.md or MIGRATIONS.unreleased.md (but not both)
# - has a reversion sibling in conf/evolutions/reversions

EVOLUTIONS_FOLDER="conf/evolutions"
RELEASED_FILE="MIGRATIONS.released.md"
UNRELEASED_FILE="MIGRATIONS.unreleased.md"

CONTENT_RELEASED=$(cat "$RELEASED_FILE")
CONTENT_UNRELEASED=$(cat "$UNRELEASED_FILE")

exit_code=0

for file in "$EVOLUTIONS_FOLDER"/*; do
    filename=$(basename "$file")

    # Skip the "reversions" directory and initial-schema
    if [[ "$filename" == "reversions" || "$filename" == "000-initial-schema.sql" ]]; then
        continue
    fi

    mentioned_in_x=$([[ "$CONTENT_RELEASED" == *"$filename"* ]] && echo 1 || echo 0)
    mentioned_in_y=$([[ "$CONTENT_UNRELEASED" == *"$filename"* ]] && echo 1 || echo 0)

    if (( mentioned_in_x == 1 && mentioned_in_y == 1 )); then
        echo "Conflict: '$filename' is listed in both MIGRATIONS.released.md and MIGRATIONS.unreleased.md."
        exit_code=1
    elif (( mentioned_in_x == 0 && mentioned_in_y == 0 )); then
        echo "Missing: '$filename' is not listed in MIGRATIONS.released.md nor MIGRATIONS.unreleased.md."
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

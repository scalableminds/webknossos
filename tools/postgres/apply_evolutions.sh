#!/bin/bash          
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

# find schema version
schema_version=`psql -A  -U postgres -h localhost --dbname="webknossos" -t -c "SELECT * FROM webknossos.releaseinformation"`
echo "Schema version: ${schema_version}"

# assert that the found schema version is a number
re='^[0-9]+$'
if ! [[ $schema_version =~ $re ]] ; then
   echo "Error: Schema version is not a number" >&2; exit 1
fi

# get list of evolutions to apply 
files=""
for entry in "${scriptdir}/../../conf/evolutions"/*.sql
do
	tmp_number=`grep -oP "[0-9]{3}" <<< $entry`
	evolution_number=$((10#$tmp_number)) # force the number to be decimal
  	if (( evolution_number > schema_version )); then
  		files="$files -f $entry"
  	fi;
done

# apply evolutions
if [ -n "$files" ]; then
	echo "Applying following evolutions: $files"
	`PGPASSWORD=postgres psql -U postgres -h localhost --dbname="webknossos" -v ON_ERROR_STOP=ON -q $files`
	echo "Successfully applied the evolutions after $schema_version"
else
	echo "There are no evolutions that can be applied."
fi;


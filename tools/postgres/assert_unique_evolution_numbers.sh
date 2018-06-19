#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

numbers="$(basename -a $(echo "$scriptdir/../../conf/evolutions/"*.sql) | cut -d'-' -f1)"

all="$(echo "$numbers" | sort)"
unique="$(echo "$all" | uniq)"

diff <(echo "$all") <(echo "$unique")

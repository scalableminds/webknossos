#!/usr/bin/env bash
set -Eeuo pipefail

scriptdir="$(dirname "$0")"

all="$(basename -a $(echo "$scriptdir/../../conf/evolutions/"*.sql) | cut -d'-' -f1 | sort)"
unique="$(echo "$all" | uniq)"

diff <(echo "$all") <(echo "$unique")

#!/usr/bin/env bash
# Runs the backend in Play dev mode on the given port (default 9001) and restarts it whenever its sources change.
# The server runs as a Mill background process, so it is stopped explicitly when this script exits.
# Set WK_DEBUG_PORT to change the debugger port (default 5005).
cd "$(dirname "$0")/.." || exit 1

./mill -w dev.runBackground "${1:-9001}" &
watcher=$!

stop_server() {
  trap - INT TERM EXIT
  kill "$watcher" 2> /dev/null
  wait "$watcher" 2> /dev/null
  ./mill clean dev.runBackground > /dev/null 2>&1
}
trap stop_server INT TERM EXIT

wait "$watcher"

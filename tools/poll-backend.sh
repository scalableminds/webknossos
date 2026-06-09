#!/usr/bin/env bash
# Polls localhost:9001 until it responds successfully, triggering the Play app to compile.
echo "Waiting for backend at localhost:9001..."
until curl -sf -o /dev/null http://localhost:9001; do
  sleep 0.5
done
echo "Backend is up."

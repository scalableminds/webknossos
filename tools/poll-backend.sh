#!/usr/bin/env bash
# Polls localhost:9001 until it responds successfully, triggering the Play app to compile.
until curl -sf -o /dev/null http://localhost:9001/api/buildinfo; do
  sleep 0.5
done

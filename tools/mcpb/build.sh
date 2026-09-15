#!/usr/bin/env bash
# Builds the WEBKNOSSOS MCP Bundle (.mcpb) for Claude Desktop and other MCPB hosts.
set -euo pipefail
cd "$(dirname "$0")"
npx -y @anthropic-ai/mcpb pack . webknossos.mcpb

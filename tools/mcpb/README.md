# WEBKNOSSOS MCP Bundle

Packages the WEBKNOSSOS [MCP server](../../docs/users/mcp.md) as an `.mcpb` bundle, which can be installed into
Claude Desktop and other MCPB hosts with a double click.

MCP Bundles can only launch *local* servers, while the WEBKNOSSOS MCP server is a remote HTTP endpoint
(`/api/mcp`). `server/index.js` is therefore a dependency-free bridge: it reads JSON-RPC messages from the MCP
stdio transport, forwards them to the configured WEBKNOSSOS instance over HTTP, and writes the responses back.

## Building

```bash
./build.sh
```

This validates `manifest.json` against the MCPB schema and writes `webknossos.mcpb`. The bundle is a build
artifact and is not checked in.

## Installing

Double-click `webknossos.mcpb`, or drag it into Claude Desktop's extension settings. On install the user is asked
for two values:

- **WEBKNOSSOS MCP URL** — e.g. `https://webknossos.org/api/mcp`, or `http://localhost:9000/api/mcp` for a local
  development instance (the default).
- **Auth Token** — from `Account Settings` > `Developer` > `Auth Token`.

## Testing the bridge without a host

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | WK_MCP_URL=http://localhost:9000/api/mcp WK_AUTH_TOKEN=<your_token> node server/index.js
```

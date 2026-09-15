# MCP Server

WEBKNOSSOS provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, so that AI agents such
as Claude Code, Claude Desktop or Cursor can work with your WEBKNOSSOS instance.
The server is part of every WEBKNOSSOS installation and is reachable at `https://<your-instance>/api/mcp`,
e.g. [https://webknossos.org/api/mcp](https://webknossos.org/api/mcp).

## Connecting

The server uses the MCP Streamable HTTP transport and is authenticated with your personal API token, which you can
copy from the `Developer` group, `Auth Token` tab in `Account Settings` (see
[Authentication Token](password.md#authentication-token)).

For Claude Code:

```bash
claude mcp add --transport http webknossos https://webknossos.org/api/mcp \
  --header "Authorization: Bearer <your_api_token>"
```

For Claude Desktop, install the MCP Bundle (`.mcpb`) built from `tools/mcpb` in the WEBKNOSSOS repository. Double-click
the bundle and enter the MCP URL of your instance and your auth token when asked.

Other clients are usually configured with a JSON snippet like this:

```json
{
  "mcpServers": {
    "webknossos": {
      "type": "http",
      "url": "https://webknossos.org/api/mcp",
      "headers": { "Authorization": "Bearer <your_api_token>" }
    }
  }
}
```

WEBKNOSSOS also accepts the token in the `X-Auth-Token` header, which is the header used by the rest of the
WEBKNOSSOS API.

!!! warning
    Your API token gives full access to your WEBKNOSSOS account. Treat it like a password and do not share it.

## Tools

| Tool | Description |
| --- | --- |
| `get_short_lived_api_token` | Creates a short-lived API token for your account, along with the URL of the instance and your organization ID. |
| `list_python_library_docs` | Returns the index of the WEBKNOSSOS Python library documentation. |
| `read_python_library_docs_page` | Returns a single page of that documentation. |

The intended workflow is that the agent asks for a short-lived token, looks up the API of the
[WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) in the documentation, and then writes and runs
Python code against your instance, e.g.:

```python
import webknossos as wk

with wk.webknossos_context(url="https://webknossos.org", token="<short_lived_token>"):
    dataset = wk.Dataset.open_remote("my-dataset")
```

## Short-lived tokens

Short-lived tokens have the same permissions as your account, but expire after one day (configurable by the instance
operator). They are meant to be handed to tools and scripts instead of your permanent API token.

- They are held in memory only, so they do not survive a restart of the WEBKNOSSOS backend.
- They are all revoked when you revoke your API token
  (see [Token Revocation](password.md#token-revocation)) or log out everywhere.

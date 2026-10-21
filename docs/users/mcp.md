# MCP Server

WEBKNOSSOS provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, so that AI agents such
as Claude Code, Claude Desktop or Cursor can work with your WEBKNOSSOS instance.
The server is part of every WEBKNOSSOS installation and is reachable at `https://<your-instance>/api/mcp`,
e.g. [https://webknossos.org/api/mcp](https://webknossos.org/api/mcp).

## Connecting

The server uses the MCP Streamable HTTP transport and is authenticated with your personal API token. Everything
needed to connect is on the `MCP Agent Connections` tab of the `Developer` group in `Account Settings`, filled in
for your instance and your account.

### Claude Code

The `Claude Code` card shows a ready-to-paste command. Copy it, run it in a terminal, and that session has
WEBKNOSSOS connected:

```bash
claude --mcp-config '{"mcpServers":{"webknossos":{"type":"http","url":"https://webknossos.org/api/mcp","headers":{"X-Auth-Token":"<your_api_token>"}}}}'
```

This registers the server for that one session only. To register it permanently instead:

```bash
claude mcp add --transport http webknossos https://webknossos.org/api/mcp \
  --header "X-Auth-Token: <your_api_token>"
```

!!! warning
    The one-line command contains your API token, so it will be stored in your shell history.

### Claude Desktop

Download the MCP Bundle (`.mcpb`) from the `Claude Desktop` card and double-click it to install. The URL of your
instance is already filled in, so only the auth token has to be entered.

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
| `list_em_processing_skills` | Returns the catalogue of the EM-Skills collection for volume EM processing. |
| `read_em_processing_skill` | Returns one skill from that collection. |

The intended workflow is that the agent asks for a short-lived token, looks up the API of the
[WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) in the documentation, and then writes and runs
Python code against your instance, e.g.:

```python
import webknossos as wk

with wk.webknossos_context(url="https://webknossos.org", token="<short_lived_token>"):
    dataset = wk.Dataset.open_remote("my-dataset")
```

## Volume EM processing skills

For processing and analysing the data itself, the server also points agents at
[EM-Skills](https://github.com/yanchaoz/EM-Skills), a third-party collection of agent skills for volume electron
microscopy: neuron segmentation (SegNeuron), mitochondria segmentation (MitoNet/Empanada), embedding-guided
annotation planning, segmentation review and Neuroglancer video rendering.

The skills work on local files, so they combine with the WEBKNOSSOS Python library: fetch the data from
WEBKNOSSOS, run the skill, upload the result back. `list_em_processing_skills` returns the catalogue and
`read_em_processing_skill` returns a single skill, both fetched from the repository at request time so that they
stay up to date. Nothing from that repository is bundled with WEBKNOSSOS.

## Permissions

Short-lived tokens are limited to a set of scopes, written as `resource:mode`, for example `dataset:read` or
`annotation:write`. The modes `read`, `write` and `delete` are ordered, so `write` also grants `read`, and `delete`
also grants `write`. There is a fourth mode, `administrate`, which stands apart: it is the right to manage the
datasets of an organization, which is what gates uploading one. It is granted from `Create/modify` upwards, and it
does not imply `delete`.

The `MCP Agent Connections` tab offers three levels as checkboxes:

| Level | What the agent may do |
| --- | --- |
| Read | Look at datasets, annotations and tasks, but change nothing. |
| Create/modify | Additionally upload and edit datasets, and create annotations, tasks, projects and teams. |
| Delete | Additionally delete datasets, annotations, tasks and teams. |

The selection is stored on your account when you click `Save Permissions`, and applies to every agent connection.

Saving applies immediately, also to agents that are already running: every request is checked against the
permissions currently stored on your account, not against the ones that were in effect when the agent connected.
Widening them works the same way, without reconnecting.

`Revoke Agent Tokens` on the same tab additionally invalidates the tokens already handed out, which is what you
want when an agent misbehaved rather than when you simply narrowed its permissions. It does not touch your own
API token.

The levels cover everything the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) can do, so
an agent granted `Delete` can use the whole library. The organization itself stays read-only at every level.

!!! note
    Because the Python library creates teams and updates users (to assign team memberships), `Create/modify` also
    allows that. If the connecting user is an admin, an agent at that level can therefore change team memberships.

The permissions belong to your account, not to the agent: the agent cannot ask for more than they allow, whatever
it does. A request outside them is rejected with `403`, both for the WEBKNOSSOS API and for reading and writing
voxel data.

!!! warning
    These permissions restrict the short-lived tokens the MCP server hands out. They do not restrict the API token that the
    MCP connection itself is authenticated with, which still has your full permissions. An agent that can read its
    own configuration can therefore read that token. Treat scopes as a guardrail against accidental damage rather
    than as a security boundary against a hostile agent.

## Short-lived tokens

Short-lived tokens act for your account, but are limited to the agent permissions above and expire after one day
(configurable by the instance operator). They are meant to be handed to tools and scripts instead of your permanent
API token.

- They are stored in the database like other tokens, so they survive a restart of the WEBKNOSSOS backend.
- They are all revoked when you revoke your API token
  (see [Token Revocation](password.md#token-revocation)) or log out everywhere.

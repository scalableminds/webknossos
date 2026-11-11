# MCP Server

WEBKNOSSOS provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, so that AI agents such
as Claude Code, Claude Desktop or Cursor can work with your WEBKNOSSOS instance.
When enabled, it is reachable at `https://<your-instance>/api/mcp`, e.g. `https://webknossos.org/api/mcp`.

## Connecting

The MCP server is off by default. The operator of an instance enables it with `features.mcpEnabled = true` in
`application.conf`.

The server uses the MCP Streamable HTTP transport and OAuth: you add the URL of the server to your AI assistant, and
when it connects for the first time, WEBKNOSSOS opens in your browser. After logging in, you see which application
asks for access and choose what it may do (see [Permissions](#permissions)). Approving sends you back to the
assistant, which is then connected. No token has to be copied anywhere.

A connection belongs to the organization that is active when you approve it. To connect another organization,
switch to it first and connect again.

The `MCP Agent Connections` tab of the `Developer` group in `Account Settings` shows the URL of your instance's
server and lists the applications you connected.

### Claude Code

```bash
claude mcp add --transport http webknossos https://webknossos.org/api/mcp
```

Then run `/mcp` in Claude Code to connect.

### Claude Desktop and claude.ai

In the settings, go to `Connectors`, choose `Add custom connector` and enter the URL of the server, e.g.
`https://webknossos.org/api/mcp`.

### Other clients

Any MCP client that supports [OAuth](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
can connect, identified either by a client ID metadata document or via Dynamic Client Registration. Clients cannot
connect with an API token.

!!! note
    With Dynamic Client Registration, an application registers itself and chooses its own name, which nothing
    verifies. The consent page points this out. Check where you will be sent back to before you approve.

## Tools

| Tool | Description |
| --- | --- |
| `get_short_lived_api_token` | Creates a short-lived API token for your account, limited to the permissions of the connection, along with the URL of the instance and your organization ID. |
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

When you approve a connection, you choose one of three permission levels:

| Level | What the agent may do |
| --- | --- |
| Read | Look at datasets, annotations and tasks, but change nothing. |
| Create/modify | Additionally upload and edit datasets, and create annotations, tasks, projects and teams. |
| Delete | Additionally delete datasets, annotations, tasks and teams. |

The level belongs to the connection. To change it, connect the same application again and choose another level;
this takes effect immediately, also for agents that are already running.

The levels cover everything the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) can do, so
an agent granted `Delete` can use the whole library. The organization itself stays read-only at every level.

!!! note
    Because the Python library creates teams and updates users (to assign team memberships), `Create/modify` also
    allows that. If the connecting user is an admin, an agent at that level can therefore change team memberships.

Internally, a level is a set of scopes, written as `resource:mode`, for example `dataset:read` or
`annotation:write`. The modes `read`, `write` and `delete` are ordered, so `write` also grants `read`, and `delete`
also grants `write`. There is a fourth mode, `administrate`, which stands apart: it is the right to manage the
datasets of an organization, which is what gates uploading one. It is granted from `Create/modify` upwards, and it
does not imply `delete`.

A request outside the permissions is rejected with `403`, both for the WEBKNOSSOS API and for reading and writing
voxel data. An agent can never reach your API token, approve connections or change their permissions.

## Disconnecting

The `MCP Agent Connections` tab lists the connected applications with their permission level and when they were
last used. `Disconnect` revokes a connection immediately, including all short-lived tokens the agent obtained
through it. [Logging out everywhere](password.md#log-out-everywhere) disconnects all
applications.

## Short-lived tokens

The MCP server itself only offers a few tools. To work with your data, an agent asks it for a short-lived token,
which it then uses with the WEBKNOSSOS Python library. These tokens act for your account, limited to the
permissions of the connection, and expire after one day (configurable by the instance operator with
`silhouette.tokenAuthenticator.shortLivedExpiry`).

The OAuth tokens of the connection itself are only accepted by the MCP server. They expire after one hour and are
renewed by the client automatically; a connection that is not used for 30 days expires.

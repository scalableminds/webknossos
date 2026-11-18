# MCP Server

WEBKNOSSOS provides an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server, so that AI agents such
as Claude Code, Claude Desktop or Cursor can work with your WEBKNOSSOS instance via the WEBKNSOSOS python library.
When enabled, it is reachable at `https://<your-instance>/api/mcp`, e.g. `https://webknossos.org/api/mcp`.

## Connecting

The server uses the MCP Streamable HTTP transport and OAuth: you add the URL of the server to your AI assistant, and
when it connects for the first time, WEBKNOSSOS opens in your browser. After logging in, you see which application
asks for access and choose what it may do (see [Permissions](#permissions)). Approving sends you back to the
assistant, which is then connected.

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

## Permissions

When you approve a connection, you choose one of three permission levels:

| Level | What the agent may do |
| --- | --- |
| Read | Look at datasets, annotations and tasks, but change nothing. |
| Create/modify | Additionally upload and edit datasets, create annotations, tasks, projects and teams, and edit users (see the warning below). |
| Delete | Additionally delete datasets, annotations, tasks and teams. |

The level belongs to the connection. To change it, connect the same application again and choose another level;
this takes effect immediately, also for agents that are already running. Only data that the agent read or wrote in
the last two minutes may stay accessible at the old level for up to two more minutes, because the data servers cache
access checks.

The levels cover everything the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) can do, so
an agent granted `Delete` can use the whole library. The organization itself stays read-only at every level.

!!! warning
    Because the Python library creates teams and updates users, `Create/modify` includes everything you can do in
    user management yourself. For a team manager, that is changing the team memberships and experiences of the users
    in their teams. For an admin, it also includes activating and deactivating users and granting or revoking the
    admin and dataset manager roles. If you are an admin, only grant `Create/modify` or `Delete` to an agent you
    would trust with that, and choose `Read` otherwise.

Internally, a level is a set of scopes, written as `resource:mode`, for example `dataset:read` or
`annotation:write`. The modes `read`, `write` and `delete` are ordered, so `write` also grants `read`, and `delete`
also grants `write`. There is a fourth mode, `administrate`, which stands apart: it is the right to manage the
datasets of an organization, which is what gates uploading one. It is granted from `Create/modify` upwards, and it
does not imply `delete`.

A request outside the permissions is rejected with `403`, both for the WEBKNOSSOS API and for reading and writing
voxel data. An agent can never reach your API token, approve connections or change their permissions.

## Disconnecting

The `MCP Agent Connections` tab lists the connected applications with their permission level and when they were
last used. `Disconnect` revokes a connection immediately. [Logging out everywhere](password.md#log-out-everywhere) disconnects all
applications.

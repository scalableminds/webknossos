#!/usr/bin/env node
/*
 * Bridges the MCP stdio transport to the remote WEBKNOSSOS MCP server, which speaks JSON-RPC over HTTP POST.
 *
 * MCP Bundles (.mcpb) can only launch local servers, so this thin proxy is what the host app runs. It has no
 * dependencies: every message read from stdin is forwarded to WK_MCP_URL with the auth token attached, and the
 * response is written back to stdout. Notifications (which WEBKNOSSOS answers with 202 and an empty body) are
 * not answered, as required by JSON-RPC.
 *
 * Anything logged must go to stderr, stdout carries the protocol.
 */

const url = process.env.WK_MCP_URL;
const token = process.env.WK_AUTH_TOKEN;

if (!url) {
  console.error("WK_MCP_URL is not set. Configure the WEBKNOSSOS URL in the extension settings.");
  process.exit(1);
}
if (!token) {
  console.error("WK_AUTH_TOKEN is not set. Configure your WEBKNOSSOS auth token in the extension settings.");
  process.exit(1);
}

const INTERNAL_ERROR = -32603;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, message) {
  // Only requests get an answer; a failed notification has nobody to report to but the log.
  if (id === undefined || id === null) {
    console.error(message);
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message } });
}

let pendingRequests = 0;
let stdinEnded = false;

function exitWhenDone() {
  if (stdinEnded && pendingRequests === 0) process.exit(0);
}

async function forward(message) {
  const id = message?.id;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Auth-Token": token,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    sendError(id, `Could not reach the WEBKNOSSOS MCP server at ${url}: ${error.message}`);
    return;
  }

  if (response.status === 401) {
    sendError(id, "WEBKNOSSOS rejected the auth token. Check the token in the extension settings.");
    return;
  }

  const body = (await response.text()).trim();

  if (!response.ok && !body.startsWith("{")) {
    sendError(id, `WEBKNOSSOS returned HTTP ${response.status}: ${body.slice(0, 200)}`);
    return;
  }

  // 202 with an empty body is the expected answer to a notification, which must stay unanswered.
  if (body === "") {
    return;
  }

  try {
    send(JSON.parse(body));
  } catch {
    sendError(id, `WEBKNOSSOS returned a malformed response: ${body.slice(0, 200)}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line === "") continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      console.error(`Ignoring unparsable message from the client: ${error.message}`);
      continue;
    }
    pendingRequests += 1;
    forward(message).finally(() => {
      pendingRequests -= 1;
      exitWhenDone();
    });
  }
});

// The host closes stdin to shut us down; finish whatever is still in flight first.
process.stdin.on("end", () => {
  stdinEnded = true;
  exitWhenDone();
});

import { idUserA, resetDatabase, tokenUserA } from "test/e2e_setup";
import { beforeEach, describe, it } from "vitest";

// These tests talk to the backend with fetch directly instead of using rest_api.ts, because they need to choose
// the token per request. The fetch wrapper in e2e_setup only injects the default token when headers is a Headers
// instance, so passing a plain object leaves the X-Auth-Token header as set here.
async function requestWithToken(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; useBearerHeader?: boolean } = {},
): Promise<Response> {
  const authHeader: Record<string, string> = init.useBearerHeader
    ? { Authorization: `Bearer ${token}` }
    : { "X-Auth-Token": token };
  return fetch(path, {
    method: init.method ?? "GET",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: init.body != null ? JSON.stringify(init.body) : undefined,
  });
}

async function createShortLivedToken(): Promise<{ token: string; scopes: string }> {
  const response = await requestWithToken("/api/mcp", tokenUserA, {
    method: "POST",
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_short_lived_api_token", arguments: {} },
    },
  });
  const { result } = await response.json();
  if (result.isError)
    throw new Error(`Creating a short-lived token failed: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

async function setAgentScopes(scopes: string): Promise<void> {
  const response = await requestWithToken("/api/mcp/permissions", tokenUserA, {
    method: "PUT",
    body: { scopes },
  });
  if (!response.ok) throw new Error(`Setting agent scopes failed with status ${response.status}`);
}

describe("Short-lived tokens via MCP (E2E)", () => {
  beforeEach(async () => {
    resetDatabase();
  });

  it("are handed out by the MCP server and authenticate as their user", async ({ expect }) => {
    const { token, scopes } = await createShortLivedToken();
    expect(token.startsWith("wkst_")).toBe(true);
    expect(scopes).toMatchSnapshot();

    const viaAuthToken = await requestWithToken("/api/user", token);
    expect(viaAuthToken.status).toBe(200);
    expect((await viaAuthToken.json()).id).toBe(idUserA);

    const viaBearer = await requestWithToken("/api/user", token, { useBearerHeader: true });
    expect(viaBearer.status).toBe(200);
    expect((await viaBearer.json()).id).toBe(idUserA);
  });

  it("cannot be traded in for the unscoped API token or a datastore token", async ({ expect }) => {
    const { token } = await createShortLivedToken();

    const apiTokenResponse = await requestWithToken("/api/auth/token", token);
    expect(apiTokenResponse.status).toBe(403);

    // Asking for a datastore token yields another short-lived token, which is scoped as well.
    const dataStoreTokenResponse = await requestWithToken("/api/userToken/generate", token, {
      method: "POST",
    });
    expect(dataStoreTokenResponse.status).toBe(200);
    const { token: dataStoreToken } = await dataStoreTokenResponse.json();
    expect(dataStoreToken.startsWith("wkst_")).toBe(true);
    expect(dataStoreToken).not.toBe(token);
    expect((await requestWithToken("/api/user", dataStoreToken)).status).toBe(200);
  });

  it("cannot dodge their scopes by sending a second token header", async ({ expect }) => {
    const { token } = await createShortLivedToken();
    const requestWithBothHeaders = (path: string, authToken: string) =>
      fetch(path, {
        headers: { "X-Auth-Token": authToken, Authorization: `Bearer ${token}` },
      });

    // If any header carries a short-lived token, the request is scoped, whatever the other header holds.
    expect((await requestWithBothHeaders("/api/auth/token", "unknownToken")).status).toBe(403);
    expect((await requestWithBothHeaders("/api/auth/token", tokenUserA)).status).toBe(403);

    // An unknown X-Auth-Token must not make the authentication fall back to the Bearer header.
    // /api/user is allowed for short-lived tokens, so this checks the authentication rather than the scopes.
    expect((await requestWithBothHeaders("/api/user", "unknownToken")).status).toBe(401);
  });

  it("follow the current agent permissions of their user", async ({ expect }) => {
    const { token } = await createShortLivedToken();
    expect((await requestWithToken("/api/user", token)).status).toBe(200);

    await setAgentScopes("none");
    expect((await requestWithToken("/api/user", token)).status).toBe(403);

    await setAgentScopes("read");
    expect((await requestWithToken("/api/user", token)).status).toBe(200);

    // resetDatabase does not clear the backend's user cache, so restore the default for the following tests.
    await setAgentScopes("write");
  });

  it("are revoked via the MCP token revocation, without affecting the API token", async ({
    expect,
  }) => {
    const { token: tokenA } = await createShortLivedToken();
    const { token: tokenB } = await createShortLivedToken();

    const revokeResponse = await requestWithToken("/api/mcp/tokens", tokenUserA, {
      method: "DELETE",
    });
    expect(revokeResponse.status).toBe(200);

    expect((await requestWithToken("/api/user", tokenA)).status).toBe(401);
    expect((await requestWithToken("/api/user", tokenB)).status).toBe(401);
    expect((await requestWithToken("/api/user", tokenUserA)).status).toBe(200);
  });

  it("are revoked when the user revokes their API token", async ({ expect }) => {
    const { token } = await createShortLivedToken();

    const revokeResponse = await requestWithToken("/api/auth/token", tokenUserA, {
      method: "DELETE",
    });
    expect(revokeResponse.status).toBe(200);

    expect((await requestWithToken("/api/user", token)).status).toBe(401);
  });
});

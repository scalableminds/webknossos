import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { idUserA, resetDatabase, tokenUserA } from "test/e2e_setup";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// These tests talk to the backend with fetch directly instead of using rest_api.ts, because they need to choose the
// credentials per request. The fetch wrapper in e2e_setup only injects the default token when headers is a Headers
// instance, so passing a plain object leaves the headers as set here.

const redirectUri = "http://localhost:51234/callback";

// The test client's metadata document is served from a local http server. The e2e backend allows http client ids
// (webKnossos.mcp.allowInsecureClientMetadataUrls), production instances only accept https on public addresses.
let metadataServer: Server;
let clientId: string;

beforeAll(async () => {
  metadataServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        client_id: clientId,
        client_name: "E2E Test Client",
        redirect_uris: ["http://localhost/callback"], // loopback, so any port matches
        token_endpoint_auth_method: "none",
      }),
    );
  });
  await new Promise<void>((resolve) => metadataServer.listen(0, "127.0.0.1", resolve));
  clientId = `http://127.0.0.1:${(metadataServer.address() as AddressInfo).port}/client.json`;
});

afterAll(() => {
  metadataServer.close();
});

function withApiToken(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "X-Auth-Token": token, ...(init.headers as Record<string, string>) },
  };
}

async function getIssuer(): Promise<string> {
  const response = await fetch("/.well-known/oauth-authorization-server");
  return (await response.json()).issuer;
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function authorizationParams(challenge: string): Promise<Record<string, string>> {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state: "someState",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "write",
    resource: `${await getIssuer()}/api/mcp`,
  };
}

async function authorize(
  params: Record<string, string>,
  level: string,
  approved = true,
): Promise<{ isValid: boolean; redirectUrl: string | null; error?: string }> {
  const response = await fetch(
    "/api/oauth/authorize",
    withApiToken(tokenUserA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params, level, approved }),
    }),
  );
  return response.json();
}

async function tokenRequest(params: Record<string, string>): Promise<Response> {
  return fetch("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

type Connection = { accessToken: string; refreshToken: string; code: string; verifier: string };

// Runs the whole authorization code flow for user A and returns the tokens.
async function connect(level = "write"): Promise<Connection> {
  const { verifier, challenge } = createPkce();
  const params = await authorizationParams(challenge);
  const { redirectUrl } = await authorize(params, level);
  const code = new URL(redirectUrl as string).searchParams.get("code") as string;
  const response = await tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!response.ok) throw new Error(`Token request failed: ${await response.text()}`);
  const tokens = await response.json();
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, code, verifier };
}

let rpcId = 0;
async function mcpRequest(
  accessToken: string,
  method: string,
  params: object = {},
): Promise<Response> {
  rpcId += 1;
  return fetch("/api/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }),
  });
}

async function getAgentToken(accessToken: string): Promise<{ token: string; scopes: string }> {
  const response = await mcpRequest(accessToken, "tools/call", {
    name: "get_short_lived_api_token",
    arguments: {},
  });
  const { result } = await response.json();
  if (result.isError)
    throw new Error(`Creating a short-lived token failed: ${result.content[0].text}`);
  return JSON.parse(result.content[0].text);
}

async function statusWithApiToken(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<number> {
  return (await fetch(path, withApiToken(token, init))).status;
}

// Needs team:write. With that scope the empty body fails validation (400), without it the scope check fails (403).
async function createTeamStatus(token: string): Promise<number> {
  return statusWithApiToken("/api/teams", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

describe("MCP server with OAuth (E2E)", () => {
  beforeEach(async () => {
    resetDatabase();
  });

  it("publishes its OAuth metadata", async ({ expect }) => {
    const issuer = await getIssuer();
    const authorizationServer = await (
      await fetch("/.well-known/oauth-authorization-server")
    ).json();
    expect(authorizationServer.code_challenge_methods_supported).toEqual(["S256"]);
    expect(authorizationServer.client_id_metadata_document_supported).toBe(true);
    expect(authorizationServer.registration_endpoint).toBe(`${issuer}/api/oauth/register`);

    const resource = await (await fetch("/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(resource.resource).toBe(`${issuer}/api/mcp`);
    expect(resource.authorization_servers).toEqual([issuer]);
  });

  it("asks unauthenticated clients to log in via OAuth, and does not accept API tokens", async ({
    expect,
  }) => {
    const response = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "/.well-known/oauth-protected-resource/api/mcp",
    );

    expect((await mcpRequest(tokenUserA, "ping")).status).toBe(401);
  });

  it("connects a client via the authorization code flow", async ({ expect }) => {
    const { verifier, challenge } = createPkce();
    const params = await authorizationParams(challenge);

    const info = await (
      await fetch(
        `/api/oauth/authorizationRequest?${new URLSearchParams(params)}`,
        withApiToken(tokenUserA),
      )
    ).json();
    expect(info.isValid).toBe(true);
    expect(info.clientName).toBe("E2E Test Client");
    expect(info.requestedLevel).toBe("write");

    const { redirectUrl } = await authorize(params, "write");
    const redirect = new URL(redirectUrl as string);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(redirectUri);
    expect(redirect.searchParams.get("state")).toBe("someState");
    expect(redirect.searchParams.get("iss")).toBe(await getIssuer());

    const tokenResponse = await tokenRequest({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code") as string,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe("write");

    const initialize = await mcpRequest(tokens.access_token, "initialize", {
      protocolVersion: "2025-11-25",
    });
    expect(initialize.status).toBe(200);
    expect((await initialize.json()).result.serverInfo.name).toBe("webknossos");

    const grants = await (await fetch("/api/oauth/grants", withApiToken(tokenUserA))).json();
    expect(grants.map((grant: { clientId: string }) => grant.clientId)).toEqual([clientId]);
  });

  it("connects a client that registered itself (Dynamic Client Registration)", async ({
    expect,
  }) => {
    const registration = await fetch("/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Registered Test Client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    expect(registration.status).toBe(201);
    const { client_id: registeredClientId, token_endpoint_auth_method } = await registration.json();
    // Clients are always public, they get no secret.
    expect(token_endpoint_auth_method).toBe("none");

    const { verifier, challenge } = createPkce();
    const params = { ...(await authorizationParams(challenge)), client_id: registeredClientId };
    const info = await (
      await fetch(
        `/api/oauth/authorizationRequest?${new URLSearchParams(params)}`,
        withApiToken(tokenUserA),
      )
    ).json();
    expect(info.isValid).toBe(true);
    expect(info.isRegisteredClient).toBe(true);
    expect(info.clientName).toBe("Registered Test Client");

    const { redirectUrl } = await authorize(params, "read");
    const tokenResponse = await tokenRequest({
      grant_type: "authorization_code",
      code: new URL(redirectUrl as string).searchParams.get("code") as string,
      client_id: registeredClientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(tokenResponse.status).toBe(200);
    const { access_token } = await tokenResponse.json();
    expect((await mcpRequest(access_token, "ping")).status).toBe(200);
  });

  it("rejects registrations with unacceptable redirect URIs", async ({ expect }) => {
    const registration = await fetch("/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }),
    });
    expect(registration.status).toBe(400);
    expect((await registration.json()).error).toBe("invalid_redirect_uri");
  });

  it("hands out agent tokens that act for the user, limited to the grant", async ({ expect }) => {
    const { accessToken } = await connect("write");
    const { token } = await getAgentToken(accessToken);
    expect(token.startsWith("wkst_")).toBe(true);

    const userResponse = await fetch("/api/user", withApiToken(token));
    expect(userResponse.status).toBe(200);
    expect((await userResponse.json()).id).toBe(idUserA);
    expect(
      (await fetch("/api/user", { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200);

    // Neither the unscoped API token, nor the MCP server or the OAuth endpoints are reachable for agents.
    expect(await statusWithApiToken("/api/auth/token", token)).toBe(403);
    expect(await statusWithApiToken("/api/oauth/grants", token)).toBe(403);

    // Asking for a datastore token yields another short-lived token, which is scoped as well.
    const dataStoreTokenResponse = await fetch(
      "/api/userToken/generate",
      withApiToken(token, { method: "POST" }),
    );
    expect(dataStoreTokenResponse.status).toBe(200);
    const { token: dataStoreToken } = await dataStoreTokenResponse.json();
    expect(dataStoreToken.startsWith("wkst_")).toBe(true);
    expect(dataStoreToken).not.toBe(token);
    expect(await statusWithApiToken("/api/user", dataStoreToken)).toBe(200);
  });

  it("enforces the approved permission level, and follows a new approval", async ({ expect }) => {
    const { accessToken } = await connect("read");
    const { token } = await getAgentToken(accessToken);
    expect(await statusWithApiToken("/api/user", token)).toBe(200);
    expect(await createTeamStatus(token)).toBe(403);

    // Approving the same client again updates its grant, which already issued tokens follow.
    await connect("write");
    expect(await createTeamStatus(token)).not.toBe(403);
  });

  it("cannot dodge the scopes by sending a second token header", async ({ expect }) => {
    const { token } = await getAgentToken((await connect()).accessToken);
    const requestWithBothHeaders = (path: string, authToken: string) =>
      fetch(path, { headers: { "X-Auth-Token": authToken, Authorization: `Bearer ${token}` } });

    expect((await requestWithBothHeaders("/api/auth/token", "unknownToken")).status).toBe(403);
    expect((await requestWithBothHeaders("/api/auth/token", tokenUserA)).status).toBe(403);
    // An unknown X-Auth-Token must not make the authentication fall back to the Bearer header.
    expect((await requestWithBothHeaders("/api/user", "unknownToken")).status).toBe(401);
  });

  it("rotates refresh tokens and revokes the connection when one is reused", async ({ expect }) => {
    const { refreshToken } = await connect();
    const refresh = (token: string) =>
      tokenRequest({ grant_type: "refresh_token", refresh_token: token, client_id: clientId });

    const refreshed = await refresh(refreshToken);
    expect(refreshed.status).toBe(200);
    const { access_token: newAccessToken } = await refreshed.json();
    expect((await mcpRequest(newAccessToken, "ping")).status).toBe(200);

    const reused = await refresh(refreshToken);
    expect(reused.status).toBe(400);
    expect((await reused.json()).error).toBe("invalid_grant");
    expect((await mcpRequest(newAccessToken, "ping")).status).toBe(401);
  });

  it("accepts an authorization code once only, and checks PKCE", async ({ expect }) => {
    const { accessToken, code, verifier } = await connect();
    const exchangeAgain = await tokenRequest({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    expect(exchangeAgain.status).toBe(400);
    // A reused code has leaked, so the connection is revoked.
    expect((await mcpRequest(accessToken, "ping")).status).toBe(401);

    const { challenge } = createPkce();
    const { redirectUrl } = await authorize(await authorizationParams(challenge), "write");
    const wrongVerifier = await tokenRequest({
      grant_type: "authorization_code",
      code: new URL(redirectUrl as string).searchParams.get("code") as string,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: createPkce().verifier,
    });
    expect(wrongVerifier.status).toBe(400);
    expect((await wrongVerifier.json()).error).toBe("invalid_grant");
  });

  it("tells the client when the user denies", async ({ expect }) => {
    const { challenge } = createPkce();
    const { redirectUrl } = await authorize(await authorizationParams(challenge), "write", false);
    const redirect = new URL(redirectUrl as string);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  it("does not redirect to unregistered redirect URIs", async ({ expect }) => {
    const { challenge } = createPkce();
    const params = {
      ...(await authorizationParams(challenge)),
      redirect_uri: "https://evil.example.com/callback",
    };
    const response = await authorize(params, "write");
    expect(response.isValid).toBe(false);
    expect(response.redirectUrl).toBeNull();
  });

  it("disconnects a client, including its agent tokens", async ({ expect }) => {
    const { accessToken } = await connect();
    const { token } = await getAgentToken(accessToken);
    const [grant] = await (await fetch("/api/oauth/grants", withApiToken(tokenUserA))).json();

    expect(
      await statusWithApiToken(`/api/oauth/grants/${grant.id}`, tokenUserA, { method: "DELETE" }),
    ).toBe(200);
    expect((await mcpRequest(accessToken, "ping")).status).toBe(401);
    expect(await statusWithApiToken("/api/user", token)).toBe(401);
    expect(await statusWithApiToken("/api/user", tokenUserA)).toBe(200);
  });
});

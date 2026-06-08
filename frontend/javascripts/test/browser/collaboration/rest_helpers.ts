import urljoin from "url-join";
import { createExplorational, getUsers } from "../../../admin/rest_api";
import { BASE_URL, ORG_NAME, WK_AUTH_TOKEN } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type APIUser = {
  id: string;
  email: string;
  isActive: boolean;
  teams: Array<{ id: string; name: string; isTeamManager: boolean }>;
};

export type APITeam = { id: string; name: string };

export type APIAnnotation = { id: string; typ: string };

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

export function adminHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Auth-Token": WK_AUTH_TOKEN!,
  };
}

// Factory — returns a fresh object every time because the Request lib mutates
// options.headers in-place (replacing the plain object with a Headers instance),
// which would break any subsequent call that reuses the same options object.
export function adminRequestOptions() {
  return {
    host: BASE_URL,
    doNotInvestigate: true,
    headers: { "X-Auth-Token": WK_AUTH_TOKEN! },
  };
}

export async function apiGet<T>(apiPath: string): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), { headers: adminHeaders() });
  if (!res.ok) throw new Error(`GET ${apiPath} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function parseJsonOrVoid<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return undefined as T;
}

export async function apiPost<T>(apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${apiPath} failed: ${res.status} ${await res.text()}`);
  return parseJsonOrVoid<T>(res);
}

export async function apiPatch<T>(apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${apiPath} failed: ${res.status} ${await res.text()}`);
  return parseJsonOrVoid<T>(res);
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export async function getUserByEmail(email: string): Promise<APIUser | undefined> {
  const users = await getUsers(adminRequestOptions());
  return users.find((u) => u.email === email);
}

export async function getOrCreateUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<APIUser> {
  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    console.log(`User ${email} already exists (id=${existingUser.id})`);
    return existingUser;
  }

  await apiPost<APIUser>("/api/auth/register", {
    organization: ORG_NAME,
    organizationName: ORG_NAME,
    firstName,
    lastName,
    email,
    password: { password1: password, password2: password },
    privacy_check: true,
  });
  const newUser = await getUserByEmail(email);
  if (newUser == null) {
    throw new Error(`Creation of user for ${email} did not work.`);
  }
  console.log(`Created user ${email} (id=${newUser.id})`);
  return newUser;
}

export async function activateUser(userId: string): Promise<void> {
  await apiPatch(`/api/users/${userId}`, { isActive: true });
  console.log(`Activated user ${userId}`);
}

export async function resolveDatasetId(datasetName: string): Promise<string> {
  const res = await fetch(
    urljoin(BASE_URL, `/api/datasets/disambiguate/${ORG_NAME}/${datasetName}/toId`),
    { headers: adminHeaders() },
  );
  if (!res.ok) {
    throw new Error(
      `Could not resolve dataset "${datasetName}": ${res.status} ${await res.text()}`,
    );
  }
  const { id } = await res.json();
  return id;
}

export async function createHybridAnnotation(datasetId: string): Promise<APIAnnotation> {
  // createExplorational sends the layers array as the POST body, which is what the
  // backend expects. "hybrid" produces both a Skeleton and a Volume layer.
  const annotation = await createExplorational(
    datasetId,
    "hybrid",
    true,
    null,
    null,
    null,
    adminRequestOptions(),
  );
  console.log(`Created annotation ${annotation.id}`);
  return annotation;
}

export async function getDefaultTeamId(): Promise<string> {
  const teams = await apiGet<APITeam[]>("/api/teams");
  // TODO: adjust the team name if "default" has a different name on this instance
  const defaultTeam = teams.find((t) => t.name.toLowerCase() === "default") ?? teams[0];
  if (!defaultTeam) throw new Error("No teams found on this instance.");
  return defaultTeam.id;
}

export async function shareAnnotationWithTeam(
  annotation: APIAnnotation,
  teamId: string,
): Promise<void> {
  const res = await fetch(
    urljoin(BASE_URL, `/api/annotations/${annotation.typ}/${annotation.id}/sharedTeams`),
    {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify([teamId]),
    },
  );
  if (!res.ok) {
    throw new Error(`shareAnnotationWithTeam failed: ${res.status} ${await res.text()}`);
  }
  console.log(`Shared annotation ${annotation.id} with team ${teamId}`);
}

// Fetch the auth token for an arbitrary user by logging in via REST and reading
// /api/auth/token.  Node.js fetch does not persist cookies automatically, so we
// extract Set-Cookie from the login response and forward it manually.
export async function getUserAuthToken(email: string, password: string): Promise<string> {
  const loginRes = await fetch(urljoin(BASE_URL, "/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed for ${email}: ${loginRes.status} ${await loginRes.text()}`);
  }
  const cookie = loginRes.headers.get("set-cookie") ?? "";
  const tokenRes = await fetch(urljoin(BASE_URL, "/api/auth/token"), {
    headers: { Cookie: cookie },
  });
  if (!tokenRes.ok) {
    throw new Error(
      `getAuthToken failed for ${email}: ${tokenRes.status} ${await tokenRes.text()}`,
    );
  }
  const { token } = await tokenRes.json();
  return token as string;
}

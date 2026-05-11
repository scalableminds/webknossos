/* eslint no-await-in-loop: 0 */

/**
 * Live Collaboration Integration Test
 *
 * Prerequisites / .env file (place at frontend/javascripts/test/puppeteer/.env):
 *   WK_AUTH_TOKEN=<admin auth token>
 *   URL=https://master.webknossos.xyz   # optional, defaults to master.webknossos.xyz
 *
 * Run with:
 *   yarn vitest --config vitest_collaboration.config.ts
 */

import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "puppeteer-core";
import urljoin from "url-join";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep } from "libs/utils";
import { vi } from "vitest";
import { createExplorational, getUsers } from "../../admin/rest_api";
import { launchBrowser } from "./dataset_rendering_helpers";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./screenshot_test_config";

vi.mock("libs/request", async (importOriginal) => {
  return await importOriginal();
});

// ---------------------------------------------------------------------------
// .env loading
// ---------------------------------------------------------------------------

function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const value = trimmed
        .substring(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional; fall back to process.env set by the caller
  }
}

loadEnvFile(path.join(__dirname, ".env"));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const N_COLLAB_USERS = 2;

// TODO: confirm the organisation name on the target instance
const ORG_NAME = "sample_organization";

// Dataset that has at least one HDF5 agglomerate mapping available
const DATASET_NAME = "l4dense_motta_et_al_dev";

// TODO: fill in the actual HDF5 mapping name available for this dataset
const HDF5_MAPPING_NAME = "TODO_hdf5_mapping_name";

// TODO: fill in two agglomerate/supervoxel IDs that exist in the dataset and
//       can be merged without side effects.  The "source" is set as the active
//       segment before the merge; the "target" is what we merge into.
const MERGE_SOURCE_AGGLOMERATE_ID = 0; // TODO
const MERGE_TARGET_AGGLOMERATE_ID = 0; // TODO
const MERGE_TARGET_SEGMENT_ID = 0; // TODO
// Position (in voxel coordinates) where the target segment is located.
// Used by the proofreading saga to look up the segment under the cursor.
const MERGE_TARGET_POSITION: [number, number, number] = [0, 0, 0]; // TODO

// Additional per-user merge/split operations performed during the parallel phase.
// Each entry describes what one collaborating user should do.
// TODO: fill in real IDs once the dataset is known
const PARALLEL_USER_OPERATIONS: Array<{
  sourceAgglomerateId: number;
  targetAgglomerateId: number;
  targetSegmentId: number;
  targetPosition: [number, number, number];
}> = [
  {
    sourceAgglomerateId: 0, // TODO
    targetAgglomerateId: 0, // TODO
    targetSegmentId: 0, // TODO
    targetPosition: [0, 0, 0], // TODO
  },
  {
    sourceAgglomerateId: 0, // TODO
    targetAgglomerateId: 0, // TODO
    targetSegmentId: 0, // TODO
    targetPosition: [0, 0, 0], // TODO
  },
];

// ---------------------------------------------------------------------------
// Credentials (read from .env or environment)
// ---------------------------------------------------------------------------

const { WK_AUTH_TOKEN } = process.env;
const BASE_URL = (() => {
  let url = process.env.URL ?? "https://master.webknossos.xyz/";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
})();

if (!WK_AUTH_TOKEN) throw new Error("WK_AUTH_TOKEN must be set (see .env).");

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

function adminHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Auth-Token": WK_AUTH_TOKEN!,
  };
}

// Factory — returns a fresh object every time because the Request lib mutates
// options.headers in-place (replacing the plain object with a Headers instance),
// which would break any subsequent call that reuses the same options object.
function adminRequestOptions() {
  return {
    host: BASE_URL,
    doNotInvestigate: true,
    headers: { "X-Auth-Token": WK_AUTH_TOKEN! },
  };
}

async function apiGet<T>(apiPath: string): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), { headers: adminHeaders() });
  if (!res.ok) throw new Error(`GET ${apiPath} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function parseJsonOrVoid<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return undefined as T;
}

async function apiPost<T>(apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${apiPath} failed: ${res.status} ${await res.text()}`);
  return parseJsonOrVoid<T>(res);
}

async function apiPatch<T>(apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(urljoin(BASE_URL, apiPath), {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${apiPath} failed: ${res.status} ${await res.text()}`);
  return parseJsonOrVoid<T>(res);
}

type APIUser = {
  id: string;
  email: string;
  isActive: boolean;
  teams: Array<{ id: string; name: string; isTeamManager: boolean }>;
};

type APITeam = { id: string; name: string };

type APIAnnotation = { id: string; typ: string };

async function getUserByEmail(email: string) {
  const users = await getUsers(adminRequestOptions());
  return users.find((u) => u.email === email);
}

async function getOrCreateUser(
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

async function activateUser(userId: string): Promise<void> {
  await apiPatch(`/api/users/${userId}`, { isActive: true });
  console.log(`Activated user ${userId}`);
}

async function resolveDatasetId(datasetName: string): Promise<string> {
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

async function createHybridAnnotation(datasetId: string): Promise<APIAnnotation> {
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

async function getDefaultTeamId(): Promise<string> {
  const teams = await apiGet<APITeam[]>("/api/teams");
  // TODO: adjust the team name if "default" has a different name on this instance
  const defaultTeam = teams.find((t) => t.name.toLowerCase() === "default") ?? teams[0];
  if (!defaultTeam) throw new Error("No teams found on this instance.");
  return defaultTeam.id;
}

async function shareAnnotationWithTeam(annotation: APIAnnotation, teamId: string): Promise<void> {
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

// ---------------------------------------------------------------------------
// Puppeteer helpers
// ---------------------------------------------------------------------------

// Fetch the auth token for an arbitrary user by logging in via REST and reading
// /api/auth/token.  Node.js fetch does not persist cookies automatically, so we
// extract Set-Cookie from the login response and forward it manually.
async function getUserAuthToken(email: string, password: string): Promise<string> {
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
    throw new Error(`getAuthToken failed for ${email}: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const { token } = await tokenRes.json();
  return token as string;
}

async function getNewPage(browser: Browser, authToken: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
  await page.setExtraHTTPHeaders({ "X-Auth-Token": authToken });
  return page;
}

async function openAnnotationPage(page: Page, annotationId: string): Promise<void> {
  const url = urljoin(BASE_URL, `/annotations/${annotationId}`);
  console.log(`Opening annotation at ${url}`);
  await page.goto(url, { timeout: 0 });
  await waitForTracingViewLoad(page);
  console.log("Annotation view loaded");
}

async function waitForTracingViewLoad(page: Page): Promise<void> {
  let inputCatchers = null;
  let iterations = 0;
  while (inputCatchers == null || (inputCatchers as unknown[]).length < 4) {
    iterations++;
    if (iterations > 10) console.log("Waiting suspiciously long for tracing view to load…");
    await sleep(500);
    const result = await Promise.race([
      page
        .waitForSelector(".inputcatcher", { timeout: 30_000 })
        .then(() => page.$$(".inputcatcher"))
        .then((els) => ({ type: "ok" as const, elements: els })),
      page
        .waitForSelector(".initialization-error-message", { timeout: 30_000 })
        .then(() => ({ type: "error" as const, elements: [] })),
    ]);
    if (result.type === "error") throw new Error("Tracing view showed an initialization error.");
    inputCatchers = result.elements;
  }
}

async function waitForDataLoading(page: Page): Promise<void> {
  await page.evaluate(
    (maxWait) => (window as any).webknossos.DEV.waitForCompletedDataLoading(maxWait),
    60_000,
  );
}

async function waitForMappingEnabled(page: Page): Promise<void> {
  let enabled = false;
  while (!enabled) {
    await sleep(3_000);
    enabled = await page.evaluate(() =>
      (window as any).webknossos.apiReady().then((api: any) => api.data.isMappingEnabled()),
    );
  }
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let browser: Browser;
let annotation: APIAnnotation;
const collabUsers: Array<{ id: string; email: string; authToken: string }> = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Live Collaboration", () => {
  beforeAll(async () => {
    browser = await launchBrowser("Live Collaboration");

    const datasetId = await resolveDatasetId(DATASET_NAME);
    console.log(`Dataset "${DATASET_NAME}" → id=${datasetId}`);

    for (let i = 0; i < N_COLLAB_USERS; i++) {
      const email = `collab_test_user_${i}@example.com`;
      const password = `CollabTestPwd${i}!`;
      const user = await getOrCreateUser(email, password, `CollabUser${i}`, "Test");
      if (!user.isActive) {
        await activateUser(user.id);
      }
      // TODO: ensure the user is a member of the relevant team so they can
      //       open the shared annotation.  Use PATCH /api/users/{id} with a
      //       teams array if needed.
      const authToken = await getUserAuthToken(email, password);
      collabUsers.push({ id: user.id, email, authToken });
    }

    annotation = await createHybridAnnotation(datasetId);

    const defaultTeamId = await getDefaultTeamId();
    await shareAnnotationWithTeam(annotation, defaultTeamId);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    // TODO: optionally delete the annotation and the test users created above
  });

  it("admin sets up the annotation: activate mapping, switch to proofreading, merge, save, enable othersMayEdit", async () => {
    const page = await getNewPage(browser, WK_AUTH_TOKEN!);
    const adminErrors = collectPageErrors(page);

    await openAnnotationPage(page, annotation.id);
    await waitForDataLoading(page);

    // Activate HDF5 mapping
    await page.evaluate(
      (mappingName: string) =>
        (window as any).webknossos
          .apiReady()
          .then((api: any) => api.data.activateMapping(mappingName)),
      HDF5_MAPPING_NAME,
    );
    await waitForMappingEnabled(page);
    console.log(`Mapping "${HDF5_MAPPING_NAME}" activated`);

    // Switch to proofreading tool
    await page.evaluate(() => {
      (window as any).webknossos.DEV.store.dispatch({ type: "SET_TOOL", tool: "PROOFREAD" });
    });
    // TODO: wait for the toolbar to reflect the active tool, e.g.:
    //   await page.waitForSelector('[data-tool="PROOFREAD"][aria-pressed="true"]');

    // Set the merge source as the active segment.
    // TODO: confirm the correct action type for setting the active segment.
    //       It is likely "SET_ACTIVE_CELL" — verify in
    //       viewer/model/reducers/volumetracing_reducer.ts.
    await page.evaluate((sourceId: number) => {
      (window as any).webknossos.DEV.store.dispatch({
        type: "SET_ACTIVE_CELL",
        cellId: sourceId,
        somePosition: null,
      });
    }, MERGE_SOURCE_AGGLOMERATE_ID);

    // Merge two segments.
    // The source is derived from the currently active segment in the store;
    // the target is identified by position + segmentId + agglomerateId.
    await page.evaluate(
      (position: [number, number, number], segmentId: number, agglomerateId: number) => {
        (window as any).webknossos.DEV.store.dispatch({
          type: "PROOFREAD_MERGE",
          position,
          segmentId,
          agglomerateId,
        });
      },
      MERGE_TARGET_POSITION,
      MERGE_TARGET_SEGMENT_ID,
      MERGE_TARGET_AGGLOMERATE_ID,
    );
    // TODO: replace the sleep with a proper completion signal once the
    //       proofreading saga exposes one (e.g. poll
    //       api.tracing.hasUnsavedChanges() or watch the by-product trees).
    await sleep(3_000);

    // Save
    await page.evaluate(() =>
      (window as any).webknossos.apiReady().then((api: any) => api.tracing.save()),
    );
    console.log("Admin saved annotation");

    // Enable othersMayEdit and save again to persist
    await page.evaluate(() => {
      (window as any).webknossos.DEV.store.dispatch({
        type: "SET_OTHERS_MAY_EDIT_FOR_ANNOTATION",
        othersMayEdit: true,
      });
    });
    await page.evaluate(() =>
      (window as any).webknossos.apiReady().then((api: any) => api.tracing.save()),
    );
    console.log("othersMayEdit enabled and saved");

    expect(adminErrors, "Admin session produced page errors").toHaveLength(0);

    await page.close();
  }, 120_000);

  it("collaborators merge/split in parallel, all save successfully, no errors", async () => {
    const sessions: Array<{ page: Page; errors: string[] }> = [];

    for (const { authToken } of collabUsers) {
      const page = await getNewPage(browser, authToken);
      sessions.push({ page, errors: collectPageErrors(page) });
    }

    // Open the annotation and activate the mapping in all sessions in parallel
    await Promise.all(
      sessions.map(async ({ page }) => {
        await openAnnotationPage(page, annotation.id);
        await waitForDataLoading(page);

        await page.evaluate(
          (mappingName: string) =>
            (window as any).webknossos
              .apiReady()
              .then((api: any) => api.data.activateMapping(mappingName)),
          HDF5_MAPPING_NAME,
        );
        await waitForMappingEnabled(page);

        await page.evaluate(() => {
          (window as any).webknossos.DEV.store.dispatch({ type: "SET_TOOL", tool: "PROOFREAD" });
        });
      }),
    );

    // All users perform their merge operations concurrently
    await Promise.all(
      sessions.map(async ({ page }, i) => {
        const op = PARALLEL_USER_OPERATIONS[i];
        if (op == null) return;

        // TODO: confirm correct action type for setting the active segment (see above)
        await page.evaluate((sourceId: number) => {
          (window as any).webknossos.DEV.store.dispatch({
            type: "SET_ACTIVE_CELL",
            cellId: sourceId,
            somePosition: null,
          });
        }, op.sourceAgglomerateId);

        await page.evaluate(
          (position: [number, number, number], segmentId: number, agglomerateId: number) => {
            (window as any).webknossos.DEV.store.dispatch({
              type: "PROOFREAD_MERGE",
              position,
              segmentId,
              agglomerateId,
            });
          },
          op.targetPosition,
          op.targetSegmentId,
          op.targetAgglomerateId,
        );

        // TODO: replace with a proper completion signal (see note in admin test)
        await sleep(3_000);
      }),
    );

    // All users save concurrently
    const saveResults = await Promise.allSettled(
      sessions.map(({ page }) =>
        page.evaluate(() =>
          (window as any).webknossos.apiReady().then((api: any) => api.tracing.save()),
        ),
      ),
    );

    // Every save must have succeeded
    const saveFailures = saveResults
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason);
    expect(saveFailures, "One or more users failed to save").toHaveLength(0);

    // No page errors in any session
    for (let i = 0; i < sessions.length; i++) {
      expect(
        sessions[i].errors,
        `User ${i} (${collabUsers[i].email}) had page errors`,
      ).toHaveLength(0);
    }

    // TODO: verify the merges are reflected in the saved annotation.
    //       After all saves, reload as admin and for each merge check:
    //       - a proofreading by-product tree exists in the skeleton tracing
    //       - api.data.getDataValue("segmentation", targetPosition) returns
    //         the expected merged agglomerate ID
    //
    // Example sketch:
    //   const adminPage = await getNewPage(browser, WK_AUTH_TOKEN!);
    //   await openAnnotationPage(adminPage, annotation.id);
    //   await waitForDataLoading(adminPage);
    //   await adminPage.evaluate(...activate mapping...);
    //   await waitForMappingEnabled(adminPage);
    //   const mergedId = await adminPage.evaluate(
    //     (pos) =>
    //       (window as any).webknossos.apiReady().then((api: any) =>
    //         api.data.getDataValue("segmentation", pos),
    //       ),
    //     MERGE_TARGET_POSITION,
    //   );
    //   expect(mergedId).toBe(MERGE_SOURCE_AGGLOMERATE_ID);

    await Promise.all(sessions.map(({ page }) => page.close()));
  }, 300_000);
});

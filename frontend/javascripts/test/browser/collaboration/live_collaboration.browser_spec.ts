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

import { sleep } from "libs/utils";
import type { Browser, Page } from "playwright-core";
import type { APIAnnotationType } from "types/api_types";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { proofreadMergeAction } from "viewer/model/actions/proofread_actions";
import { cycleToolAction } from "viewer/model/actions/ui_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setCollaborationModeForAnnotation, updateDatasetTeams } from "../../../admin/rest_api";
import {
  BROWSER_SPEC_TIMEOUT,
  DATASET_NAME,
  HDF5_MAPPING_NAME,
  KEEP_ALIVE_FOR_DEBUGGING,
  KEEP_ALIVE_WAITING_DURATION,
  MERGE_SOURCE_AGGLOMERATE_ID,
  MERGE_SOURCE_POSITION,
  MERGE_TARGET_POSITION,
  N_COLLAB_USERS,
  PARALLEL_USER_OPERATIONS,
  WK_AUTH_TOKEN,
} from "./config";
import {
  getNewPage,
  openAnnotationPage,
  setupPageForProofreading,
  startCollectionOfPageErrors,
  trackAnnotationUpdateRequests,
  waitForDataLoading,
  waitForMappingEnabled,
  waitUntilNotBusy,
} from "./page_helpers";
import {
  type APIAnnotation,
  activateUser,
  adminRequestOptions,
  createHybridAnnotation,
  getDefaultTeamId,
  getOrCreateUser,
  getUserAuthToken,
  resolveDatasetId,
  shareAnnotationWithTeam,
} from "./rest_helpers";

vi.mock("libs/request", async (importOriginal) => {
  // The request lib is globally mocked for unit tests. In the screenshot tests, we actually
  // want to run the proper fetch calls so we revert to the original implementation.
  return await importOriginal();
});

const DEBUG_SAVE_REQUESTS = true;

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

const browsers: Browser[] = [];
let annotation: APIAnnotation;
const collabUsers: Array<{ id: string; email: string; authToken: string }> = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Live Collaboration", () => {
  beforeAll(async () => {
    const datasetId = await resolveDatasetId(DATASET_NAME);
    console.log(`Dataset "${DATASET_NAME}" → id=${datasetId}`);

    for (let i = 0; i < N_COLLAB_USERS; i++) {
      const email = `collab_test_user_${i}@example.com`;
      const password = `CollabTestPwd${i}!`;
      const user = await getOrCreateUser(email, password, `CollabUser${i}`, "Test");
      if (!user.isActive) {
        await activateUser(user.id);
      }
      const authToken = await getUserAuthToken(email, password);
      collabUsers.push({ id: user.id, email, authToken });
    }

    const defaultTeamId = await getDefaultTeamId();
    await updateDatasetTeams(datasetId, [defaultTeamId], adminRequestOptions());
    annotation = await createHybridAnnotation(datasetId);

    await shareAnnotationWithTeam(annotation, defaultTeamId);
  }, BROWSER_SPEC_TIMEOUT);

  afterAll(async () => {
    if (KEEP_ALIVE_FOR_DEBUGGING) {
      await sleep(KEEP_ALIVE_WAITING_DURATION);
    }

    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
  }, BROWSER_SPEC_TIMEOUT);

  it(
    "admin sets up the annotation: activate mapping, switch to proofreading, merge, save, enable othersMayEdit",
    async () => {
      const { page, browser } = await getNewPage(WK_AUTH_TOKEN!);
      browsers.push(browser);
      const adminErrors = startCollectionOfPageErrors(page);

      await openAnnotationPage(page, annotation.id);
      await setupPageForProofreading(page);
      await waitForDataLoading(page);

      // Log redux actions
      await page.evaluate(() => (window.webknossos.DEV.flags.logActions = true));

      // Activate HDF5 mapping
      await page.evaluate(
        (mappingName: string) =>
          window.webknossos.apiReady().then((api) => api.data.activateMapping(mappingName, "HDF5")),
        HDF5_MAPPING_NAME,
      );
      await waitForMappingEnabled(page);
      console.log(`Mapping "${HDF5_MAPPING_NAME}" activated`);

      // Switch to proofreading tool by cycling until activeTool.id === "PROOFREAD".
      // We can't use SetActiveToolAction because the tool instance cannot be serialized/deserialized
      // for playwright.
      const cycleAction = cycleToolAction(false);
      await page.evaluate(
        ({ action, maxAttempts }: { action: any; maxAttempts: number }) => {
          const store = window.webknossos.DEV.store;
          for (let i = 0; i < maxAttempts; i++) {
            if (store.getState().uiInformation.activeTool.id === "PROOFREAD") break;
            store.dispatch(action);
          }
        },
        { action: cycleAction, maxAttempts: 100 },
      );

      // Set the merge source as the active segment.
      const setActiveCellActionObj = setActiveCellAction(
        MERGE_SOURCE_AGGLOMERATE_ID,
        MERGE_SOURCE_POSITION,
      );
      await page.evaluate(
        (action) => window.webknossos.DEV.store.dispatch(action),
        setActiveCellActionObj,
      );

      await sleep(500);
      // Merge two segments.
      const proofreadMergeActionObj = proofreadMergeAction(MERGE_TARGET_POSITION);
      await page.evaluate(
        (action) => window.webknossos.DEV.store.dispatch(action),
        proofreadMergeActionObj,
      );
      await sleep(500);

      // Save
      await page.evaluate(() => window.webknossos.apiReady().then((api) => api.tracing.save()));
      console.log("Admin saved annotation");

      // Enable Concurrent collab mode and save again to persist
      const setCollaborationModeActionObj = setCollaborationModeAction("Concurrent");
      await page.evaluate(
        (action) => window.webknossos.DEV.store.dispatch(action),
        setCollaborationModeActionObj,
      );
      await setCollaborationModeForAnnotation(
        annotation.id,
        annotation.typ as APIAnnotationType,
        "Concurrent",
        adminRequestOptions(),
      );
      await page.evaluate(() => window.webknossos.apiReady().then((api) => api.tracing.save()));
      console.log("Concurrent collaboration mode enabled and saved");

      if (adminErrors.length > 0) {
        console.warn("Found errors in admin session:", adminErrors);
      }

      await page.close();
    },
    BROWSER_SPEC_TIMEOUT,
  );

  it(
    "collaborators merge/split in parallel, all save successfully, no errors",
    async () => {
      const sessions: Array<{
        page: Page;
        errors: string[];
        getUpdateRequests: ReturnType<typeof trackAnnotationUpdateRequests>;
      }> = [];

      for (const { authToken } of collabUsers) {
        console.log("Open page with token=", authToken);
        const { page, browser } = await getNewPage(authToken);
        browsers.push(browser);
        sessions.push({
          page,
          errors: startCollectionOfPageErrors(page),
          getUpdateRequests: trackAnnotationUpdateRequests(page, annotation.id),
        });
      }

      // Open the annotation and activate the mapping in all sessions in parallel
      await Promise.all(
        sessions.map(async ({ page }) => {
          await openAnnotationPage(page, annotation.id);
          await setupPageForProofreading(page);
          await waitForDataLoading(page);

          // Log redux actions
          await page.evaluate(() => (window.webknossos.DEV.flags.logActions = true));

          const cycleActionCollab = cycleToolAction(false);
          await page.evaluate(
            ({ action, maxAttempts }: { action: any; maxAttempts: number }) => {
              const store = window.webknossos.DEV.store;
              for (let i = 0; i < maxAttempts; i++) {
                if (store.getState().uiInformation.activeTool.id === "PROOFREAD") break;
                store.dispatch(action);
              }
            },
            { action: cycleActionCollab, maxAttempts: 100 },
          );
        }),
      );

      // All users perform their merge operations concurrently
      await Promise.all(
        sessions.map(async ({ page, getUpdateRequests }, userIndex) => {
          const ops = PARALLEL_USER_OPERATIONS.filter((op) => op.userIndex === userIndex);
          for (const op of ops) {
            await page.evaluate(
              (action) => window.webknossos.DEV.store.dispatch(action),
              setPositionAction(op.sourcePosition),
            );
            const setActiveCellActionObjCollab = setActiveCellAction(
              op.sourceAgglomerateId,
              op.sourcePosition,
            );
            await page.evaluate(
              (action) => window.webknossos.DEV.store.dispatch(action),
              setActiveCellActionObjCollab,
            );

            await sleep(100); // give WK sagas some time to create the actual segment item
            await waitUntilNotBusy(page);

            const mergeDispatchTime = Date.now();
            const proofreadMergeActionObjCollab = proofreadMergeAction(op.targetPosition);
            await page.evaluate(
              (action) => window.webknossos.DEV.store.dispatch(action),
              proofreadMergeActionObjCollab,
            );

            if (DEBUG_SAVE_REQUESTS) {
              // Wait for the merge saga to finish, then save to flush the update requests.
              await sleep(1_000);
              await page.evaluate(() =>
                window.webknossos.apiReady().then((api) => api.tracing.save()),
              );

              const label = `[user ${userIndex}] merge ${JSON.stringify(op.sourcePosition)} → ${JSON.stringify(op.targetPosition)}`;
              const sent = getUpdateRequests(mergeDispatchTime);
              if (sent.length === 0) {
                console.log(`${label}: no update requests were sent (nothing to save?)`);
              } else {
                for (const r of sent) {
                  console.log(
                    `${label} update request at ${new Date(r.timestamp).toISOString()}:\n${r.body}`,
                  );
                }
              }
            }
          }
        }),
      );

      // Open a fresh admin page, reload the annotation, and verify all merges.
      const { page: adminVerifyPage, browser: adminVerifyBrowser } = await getNewPage(
        WK_AUTH_TOKEN!,
      );
      browsers.push(adminVerifyBrowser);
      await openAnnotationPage(adminVerifyPage, annotation.id);
      await setupPageForProofreading(adminVerifyPage);
      await waitForDataLoading(adminVerifyPage);

      await waitForMappingEnabled(adminVerifyPage);

      const segLayerName = await adminVerifyPage.evaluate(() =>
        window.webknossos.apiReady().then((api) => api.data.getVolumeTracingLayerIds()[0]),
      );

      const zoomStep = await adminVerifyPage.evaluate(
        async ({ layerName, position }) => {
          const api = await (window as any).webknossos.apiReady();
          return api.data.getUltimatelyRenderedZoomStepAtPosition(layerName, position);
        },
        { layerName: segLayerName, position: PARALLEL_USER_OPERATIONS[0].sourcePosition },
      );

      for (const op of PARALLEL_USER_OPERATIONS) {
        // For each merge operation, look up the (mapping-applied) segment id at the source and
        // target positions. If the merge was persisted correctly, both positions now resolve to
        // the same agglomerate id, so the two looked-up values must be equal.
        const [sourceMappedId, targetMappedId] = (await adminVerifyPage.evaluate(
          async ({ layerName, sourcePos, targetPos, zoomStep }) => {
            const api = await (window as any).webknossos.apiReady();
            return Promise.all([
              api.data.getMappedDataValue(layerName, sourcePos, zoomStep),
              api.data.getMappedDataValue(layerName, targetPos, zoomStep),
            ]);
          },
          {
            layerName: segLayerName as string,
            sourcePos: op.sourcePosition,
            targetPos: op.targetPosition,
            zoomStep,
          },
        )) as [unknown, unknown];
        expect(
          sourceMappedId,
          `Merge of ${op.sourcePosition} → ${op.targetPosition} not reflected (should be done by userIndex=${op.userIndex})`,
        ).toBe(targetMappedId);
      }

      await adminVerifyPage.close();

      // No page errors in any session
      for (let i = 0; i < sessions.length; i++) {
        const filteredErrors = sessions[i].errors.filter(
          // We filter the following message, because our sampled IDs might already belong
          // to the same segment which is okay.
          (err) => !err.includes("Both segments belong to agglomerate id="),
        );
        if (filteredErrors.length > 0) {
          console.warn("Found errors in session", i, ":", sessions[i].errors);
        }
      }

      await Promise.all(sessions.map(({ page }) => page.close()));
    },
    BROWSER_SPEC_TIMEOUT,
  );
});

import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  FakeWorker,
  mockBuildInfoRequest,
  readStoredLandmarks,
} from "test/helpers/layer_registration_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import type {
  Landmark,
  LayerNames,
  Side,
} from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import {
  LandmarkSync,
  type LandmarkSyncStatus,
} from "viewer/view/layer_registration/workspace/layer_registration_landmark_sync";
import { beforeEach, describe, expect, it } from "vitest";

const COLOR_2_PAIR: LayerNames = { fixed: "color_1", moving: "color_2" };
const COLOR_3_PAIR: LayerNames = { fixed: "color_1", moving: "color_3" };
// The tree groups in which the landmarks of the layer pair color_1 <- color_2 are stored.
// Existing layer registration annotations use these names.
const COLOR_2_FIXED_SIDE = ["color_2", "color_1 landmarks"];
const COLOR_2_MOVING_SIDE = ["color_2", "color_2 landmarks"];

const LANDMARK_1 = { pairId: 1, position: [10, 20, 30] } as const;
const LANDMARK_1_PARTNER = { pairId: 1, position: [11, 22, 33] } as const;
const LANDMARK_2 = { pairId: 2, position: [40, 50, 60] } as const;

type StoreMessageHandler = typeof handleCrossOriginApiMessage;

// A store iframe that replies with an error to the given command as long as isFailing returns
// true, and works normally otherwise.
function createFailingStore(command: string, isFailing: () => boolean): StoreMessageHandler {
  return (event) => {
    if (event.data.type === command && isFailing()) {
      event.source?.postMessage({ type: "err", messageId: event.data.messageId }, "*");
      return Promise.resolve();
    }
    return handleCrossOriginApiMessage(event);
  };
}

/** One mount of the layer registration workspace before the stored landmarks are imported:
 * the page with two fresh workers, and the WEBKNOSSOS instance of the test as the store
 * iframe. The store keeps its annotation across sessions, like the layer registration
 * annotation on the server.
 */
function createSession(
  layerNames: LayerNames,
  handleStoreMessage: StoreMessageHandler = handleCrossOriginApiMessage,
) {
  const iframes = new FakeLayerRegistrationIframes();
  const workers = { fixed: new FakeWorker(), moving: new FakeWorker() };
  iframes.mountReady("store", handleStoreMessage);
  iframes.mountReady("fixed", workers.fixed.handleMessage);
  iframes.mountReady("moving", workers.moving.handleMessage);
  const reported = {
    landmarks: null as Record<Side, Landmark[]> | null,
    statuses: [] as LandmarkSyncStatus[],
    hasUnsyncedLandmarks: [] as boolean[],
  };
  const landmarkSync = new LandmarkSync(iframes.bridge.sendMessage, layerNames, {
    onLandmarksChange: (landmarks) => {
      reported.landmarks = landmarks;
    },
    onStatusChange: (status) => reported.statuses.push(status),
    onHasUnsyncedLandmarksChange: (hasUnsynced) => reported.hasUnsyncedLandmarks.push(hasUnsynced),
  });
  return { iframes, workers, landmarkSync, reported };
}

async function startSession(layerNames: LayerNames, handleStoreMessage?: StoreMessageHandler) {
  const session = createSession(layerNames, handleStoreMessage);
  const isImported = await session.landmarkSync.importStoredLandmarks();
  return { ...session, isImported };
}

function getReplaceCount(iframes: FakeLayerRegistrationIframes) {
  return iframes.sentCommandTypes("store").filter((type) => type === "replaceTreesInGroup").length;
}

function getPairIdsAndPositions(landmarks: Landmark[] | undefined) {
  return landmarks?.map(({ pairId, position }) => ({ pairId, position }));
}

describe("Layer registration landmark sync", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton", undefined, {
      dontDispatchWkInitialized: true,
    });
    mockBuildInfoRequest(context);
  });

  it("stores the landmarks of the workers and imports them again in the next session", async () => {
    const firstSession = await startSession(COLOR_2_PAIR);
    firstSession.workers.fixed.landmarks = [LANDMARK_1, LANDMARK_2];
    firstSession.workers.moving.landmarks = [LANDMARK_1_PARTNER];
    await firstSession.landmarkSync.sync();

    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1, LANDMARK_2]);
    expect(readStoredLandmarks(COLOR_2_MOVING_SIDE)).toEqual([LANDMARK_1_PARTNER]);
    // The panel shows these landmarks.
    expect(firstSession.reported.statuses).toEqual(["ready"]);
    expect(getPairIdsAndPositions(firstSession.reported.landmarks?.fixed)).toEqual([
      LANDMARK_1,
      LANDMARK_2,
    ]);

    // E.g. after reloading the page.
    const secondSession = await startSession(COLOR_2_PAIR);
    expect(secondSession.isImported).toBe(true);
    expect(secondSession.workers.fixed.landmarks).toEqual([LANDMARK_1, LANDMARK_2]);
    expect(secondSession.workers.moving.landmarks).toEqual([LANDMARK_1_PARTNER]);
  });

  it("imports the stored landmarks only once if the first import was cancelled", async () => {
    const firstSession = await startSession(COLOR_2_PAIR);
    firstSession.workers.fixed.landmarks = [LANDMARK_1];
    await firstSession.landmarkSync.sync();

    // React runs the effect that imports the landmarks twice in development, and cancels the
    // first run.
    const { workers, landmarkSync } = createSession(COLOR_2_PAIR);
    let isFirstImportCancelled = false;
    const cancelledImport = landmarkSync.importStoredLandmarks(() => isFirstImportCancelled);
    isFirstImportCancelled = true;
    expect(await cancelledImport).toBe(false);
    expect(await landmarkSync.importStoredLandmarks()).toBe(true);

    expect(workers.fixed.landmarks).toEqual([LANDMARK_1]);
  });

  it("writes the side whose landmarks changed, also for moved and deleted landmarks", async () => {
    const { workers, landmarkSync, iframes } = await startSession(COLOR_2_PAIR);
    workers.fixed.landmarks = [LANDMARK_1, LANDMARK_2];
    workers.moving.landmarks = [LANDMARK_1_PARTNER];
    await landmarkSync.sync();
    expect(getReplaceCount(iframes)).toBe(2);

    // Nothing changed, so nothing is written, which would mark the annotation as unsaved.
    await landmarkSync.sync();
    expect(getReplaceCount(iframes)).toBe(2);

    // The user moves the landmark in the right view.
    const movedPartner = { pairId: 1, position: [12, 22, 33] } as const;
    workers.moving.landmarks = [movedPartner];
    await landmarkSync.sync();
    expect(getReplaceCount(iframes)).toBe(3);
    expect(readStoredLandmarks(COLOR_2_MOVING_SIDE)).toEqual([movedPartner]);

    // The user deletes a landmark in the left view.
    workers.fixed.landmarks = [LANDMARK_1];
    await landmarkSync.sync();
    expect(getReplaceCount(iframes)).toBe(4);
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1]);
    expect(readStoredLandmarks(COLOR_2_MOVING_SIDE)).toEqual([movedPartner]);
  });

  it("keeps the landmarks of the other moving layers", async () => {
    const color2Session = await startSession(COLOR_2_PAIR);
    color2Session.workers.fixed.landmarks = [LANDMARK_1];
    color2Session.workers.moving.landmarks = [LANDMARK_1_PARTNER];
    await color2Session.landmarkSync.sync();

    // Switching to another moving layer starts a new session.
    const color3Session = await startSession(COLOR_3_PAIR);
    expect(color3Session.workers.fixed.landmarks).toEqual([]);
    color3Session.workers.fixed.landmarks = [LANDMARK_2];
    await color3Session.landmarkSync.sync();

    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1]);
    expect(readStoredLandmarks(COLOR_2_MOVING_SIDE)).toEqual([LANDMARK_1_PARTNER]);
    expect(readStoredLandmarks(["color_3", "color_1 landmarks"])).toEqual([LANDMARK_2]);
  });

  it("never writes the landmarks of the workers if the stored ones could not be imported", async () => {
    const firstSession = await startSession(COLOR_2_PAIR);
    firstSession.workers.fixed.landmarks = [LANDMARK_1];
    await firstSession.landmarkSync.sync();

    // The workers of this session stay empty, so syncing them would delete LANDMARK_1.
    let hasFailed = false;
    const { landmarkSync, isImported, reported, iframes } = await startSession(
      COLOR_2_PAIR,
      createFailingStore("exportTreesAsNmlString", () => {
        const isFailing = !hasFailed;
        hasFailed = true;
        return isFailing;
      }),
    );
    expect(isImported).toBe(false);

    await landmarkSync.sync();
    await landmarkSync.flushAndStop();
    expect(getReplaceCount(iframes)).toBe(0);
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1]);
    // The workers stay covered, so that the user doesn't place landmarks that can't be saved.
    expect(reported.statuses).toEqual(["failed"]);
  });

  it("doesn't write while stopped, but writes the last changes when flushing", async () => {
    const { workers, landmarkSync, iframes, reported } = await startSession(COLOR_2_PAIR);
    landmarkSync.stop();
    workers.fixed.landmarks = [LANDMARK_1];
    await landmarkSync.sync();
    expect(getReplaceCount(iframes)).toBe(0);

    // E.g. after a failed switch to another moving layer.
    landmarkSync.resume();
    await landmarkSync.sync();
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1]);

    // E.g. before switching to another moving layer, right after placing a landmark.
    workers.fixed.landmarks = [LANDMARK_1, LANDMARK_2];
    await landmarkSync.flushAndStop();
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1, LANDMARK_2]);
    expect(reported.hasUnsyncedLandmarks.at(-1)).toBe(false);

    workers.fixed.landmarks = [];
    await landmarkSync.sync();
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1, LANDMARK_2]);
  });

  it("doesn't write the result of a run that was still running when the sync was stopped", async () => {
    const { workers, landmarkSync } = await startSession(COLOR_2_PAIR);
    workers.fixed.landmarks = [LANDMARK_1];
    await landmarkSync.sync();

    // The worker reloads during the next run and loses its landmarks. The page stops the sync
    // as soon as it notices the reload.
    workers.fixed.landmarks = [];
    const runningSync = landmarkSync.sync();
    landmarkSync.stop();
    await runningSync;
    expect(readStoredLandmarks(COLOR_2_FIXED_SIDE)).toEqual([LANDMARK_1]);
  });

  it("reports unsaved landmarks while writing them fails", async () => {
    let isStoreFailing = true;
    const { workers, landmarkSync, reported } = await startSession(
      COLOR_2_PAIR,
      createFailingStore("replaceTreesInGroup", () => isStoreFailing),
    );
    workers.moving.landmarks = [LANDMARK_1_PARTNER];
    await landmarkSync.sync();
    // The page asks before it is left while there are unsaved landmarks.
    expect(reported.hasUnsyncedLandmarks.at(-1)).toBe(true);

    isStoreFailing = false;
    await landmarkSync.sync();
    expect(reported.hasUnsyncedLandmarks.at(-1)).toBe(false);
    expect(readStoredLandmarks(COLOR_2_MOVING_SIDE)).toEqual([LANDMARK_1_PARTNER]);
  });

  it("tells each worker which pairs miss a landmark on its side", async () => {
    const { workers, landmarkSync } = await startSession(COLOR_2_PAIR);
    workers.fixed.landmarks = [LANDMARK_1, LANDMARK_2];
    workers.moving.landmarks = [LANDMARK_1_PARTNER];
    await landmarkSync.sync();

    expect(workers.moving.receivedPairInfos.at(-1)).toEqual({
      openPairIds: [2],
      otherMaxPairId: 2,
    });
    expect(workers.fixed.receivedPairInfos.at(-1)).toEqual({
      openPairIds: [],
      otherMaxPairId: 1,
    });
  });
});

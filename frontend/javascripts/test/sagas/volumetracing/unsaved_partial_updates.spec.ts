import Deferred from "libs/async/deferred";
import {
  createBucketResponseFunction,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import { OrthoViews, OverwriteModeEnum, type Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  addToContourListAction,
  finishEditingAction,
  resetContourAction,
  setActiveCellAction,
  startEditingAction,
} from "viewer/model/actions/volumetracing_actions";
import type { RequestBucketInfo } from "viewer/model/bucket_data_handling/wkstore_adapter";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { voxelIndexOf } from "viewer/model/volumetracing/core";
import { encodeBucketDiffBase64 } from "viewer/model/volumetracing/core/bucket_diff";
import { Model, Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInitialBucketAndAgglomerateData } from "../proofreading/proofreading_test_utils";

// In live collaboration, volume edits are saved as partial bucket updates. Until their
// save succeeds, buckets whose data arrives (again) get them re-applied, and during
// rebasing they are re-applied on top of others' updates (see unsaved_partial_updates.ts).

const VOLUME_TRACING_ID = "volumeTracingId";
const position: Vector3 = [40, 40, 43];
// The mag-1 bucket that contains `position`.
const bucketOrigin: Vector3 = [32, 32, 32];

async function setup(context: WebknossosTestContext) {
  await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
  Store.dispatch(updateUserSettingAction("brushSize", 10));
  Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
  Store.dispatch(setToolAction(AnnotationTool.BRUSH));
  Store.dispatch(setActiveCellAction(5n));
}

function brushAt(brushPosition: Vector3) {
  Store.dispatch(startEditingAction(brushPosition, OrthoViews.PLANE_XY));
  Store.dispatch(addToContourListAction(brushPosition));
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}

function hasUnsavedPartialUpdates() {
  return Store.getState().save.queue.some((entry) =>
    entry.actions.some((action) => action.name === "updateBucketPartial"),
  );
}

// Drops the mag-1 bucket that contains `voxel` from the cube, so that the next read
// fetches it again.
function evictBucketOf(voxel: Vector3) {
  const { cube } = Model.getSegmentationTracingLayer(VOLUME_TRACING_ID);
  const bucket = cube.getBucket(cube.positionToZoomedAddress(voxel, null, 0));
  if (bucket.type !== "data") throw new Error("Expected the bucket to be in the cube.");
  cube.removeBucket(bucket);
}

const getValueAt = (context: WebknossosTestContext, voxel: Vector3) =>
  context.api.data.getDataValue(VOLUME_TRACING_ID, voxel);

const LAYERS = { [VOLUME_TRACING_ID]: "uint16", color: "uint8" } as const;

// Holds back the response to the first request of the volume layer's bucket that
// contains `position` until `release` is called. All requests are answered by `respond`.
function holdBackFirstRequestOfBucket(
  context: WebknossosTestContext,
  respond: ReturnType<typeof createBucketResponseFunction>,
) {
  const released = new Deferred<void, never>();
  let requestCount = 0;
  vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    async (url: string, payload: { data: Array<RequestBucketInfo> }) => {
      const requestsBucket =
        url.includes(VOLUME_TRACING_ID) &&
        payload.data.some(
          ({ position: bucketPosition, mag }) =>
            bucketPosition.every((coordinate, axis) => coordinate === bucketOrigin[axis]) &&
            mag[0] === 1,
        );
      if (requestsBucket) {
        requestCount++;
        if (requestCount === 1) await released.promise();
      }
      return respond(url, payload);
    },
  );
  return { release: () => released.resolve(), getRequestCount: () => requestCount };
}

// A bucket response in which neither the volume layer nor its fallback layer have
// data for any bucket.
async function respondWithoutData(_url: string, payload: { data: Array<unknown> }) {
  return {
    buffer: new ArrayBuffer(0),
    headers: {
      "empty-bucket-indices": JSON.stringify(payload.data.map((_, index) => index)),
      "failure-bucket-indices": "[]",
    },
  };
}

// Lets another user save a partial update that writes 9 to the given voxels of the
// bucket that contains `position`, as the next version.
function planOthersPartialUpdate(
  backendMock: ReturnType<typeof mockInitialBucketAndAgglomerateData>,
  voxels: Vector3[],
) {
  const runAt = (voxel: Vector3) => {
    const [x, y, z] = voxel.map((coordinate, axis) => coordinate - bucketOrigin[axis]);
    return { start: voxelIndexOf(x, y, z), length: 1, value: 9n };
  };
  backendMock.planVersionInjection(Store.getState().annotation.version + 1, [
    {
      name: "updateBucketPartial",
      value: {
        actionTracingId: VOLUME_TRACING_ID,
        position: bucketOrigin,
        additionalCoordinates: undefined,
        mag: [1, 1, 1],
        voxelRunsBase64: encodeBucketDiffBase64({
          address: [1, 1, 1, 0, null],
          runs: voxels.map(runAt),
        }),
      },
    },
  ]);
}

describe("Unsaved partial bucket updates", () => {
  const previousAllowFlag = WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation;
  beforeEach(() => {
    WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation = true;
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation = previousAllowFlag;
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("are re-applied when an evicted bucket is fetched again", async (context) => {
    await setup(context);
    vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(LAYERS, 0, 0),
    );
    await context.api.data.reloadAllBuckets();
    brushAt(position);
    expect(await getValueAt(context, position)).toBe(5);

    // The backend doesn't have the stroke yet, so the fetched data lacks it.
    expect(hasUnsavedPartialUpdates()).toBe(true);
    evictBucketOf(position);
    expect(await getValueAt(context, position)).toBe(5);
    expect(hasUnsavedPartialUpdates()).toBe(true);
  });

  it<WebknossosTestContext>("are re-applied when the backend has no data for a bucket", async (context) => {
    await setup(context);
    await context.api.data.reloadAllBuckets();
    brushAt(position);
    expect(await getValueAt(context, position)).toBe(5);

    vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      respondWithoutData,
    );
    expect(hasUnsavedPartialUpdates()).toBe(true);
    evictBucketOf(position);
    expect(await getValueAt(context, position)).toBe(5);
  });

  it<WebknossosTestContext>("win over others' partial updates of the same voxels when rebasing", async (context) => {
    await setup(context);
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    await context.api.data.reloadAllBuckets();
    await context.api.tracing.save();
    // Loads the bucket, as it would be in the viewport. The backend mock doesn't apply
    // saved updates to its bucket data, so fetching the bucket again would lose them.
    expect(await getValueAt(context, position)).toBe(backendMock.fillValue);

    // Another user writes 9 to a voxel that the local stroke will cover, too, and to
    // one that it won't, in the same bucket.
    const sharedVoxel = position;
    const othersVoxel: Vector3 = [60, 60, 43];
    planOthersPartialUpdate(backendMock, [sharedVoxel, othersVoxel]);

    brushAt(position);
    // The save has to rebase onto the other user's version first.
    await context.api.tracing.save();

    expect(await getValueAt(context, sharedVoxel)).toBe(5);
    expect(await getValueAt(context, othersVoxel)).toBe(9);
    expect(hasUnsavedPartialUpdates()).toBe(false);
  });

  it<WebknossosTestContext>("win over others' partial updates of a missing bucket when rebasing", async (context) => {
    await setup(context);
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    // Nobody has annotated the bucket yet: it is missing on the backend. Once applied,
    // the backend mock doesn't return saved updates in bucket data, so a bucket that
    // is fetched again would lack them.
    vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      respondWithoutData,
    );
    await context.api.data.reloadAllBuckets();
    await context.api.tracing.save();
    expect(await getValueAt(context, position)).toBe(0);

    const sharedVoxel = position;
    const othersVoxel: Vector3 = [60, 60, 43];
    brushAt(position);
    planOthersPartialUpdate(backendMock, [sharedVoxel, othersVoxel]);
    await context.api.tracing.save();

    // The other user's runs were applied to the missing bucket in place.
    expect(await getValueAt(context, sharedVoxel)).toBe(5);
    expect(await getValueAt(context, othersVoxel)).toBe(9);
  });

  it<WebknossosTestContext>("are applied to a bucket's data that predates their save", async (context) => {
    await setup(context);
    vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(LAYERS, 0, 0),
    );
    await context.api.data.reloadAllBuckets();
    // Loads the bucket, so that the stroke doesn't cause a request of its own.
    expect(await getValueAt(context, position)).toBe(0);
    brushAt(position);
    evictBucketOf(position);

    // The bucket is requested again while the stroke's save is in flight. The response,
    // for the version from before the save, only arrives after the save went through.
    const heldRequest = holdBackFirstRequestOfBucket(
      context,
      createBucketResponseFunction(LAYERS, 0, 0),
    );
    const value = getValueAt(context, position);
    await context.api.tracing.save();
    expect(hasUnsavedPartialUpdates()).toBe(false);
    heldRequest.release();

    expect(await value).toBe(5);
    // The response was used, not requested again.
    expect(heldRequest.getRequestCount()).toBe(1);
  });

  it<WebknossosTestContext>("from others are applied to a bucket's data that predates them", async (context) => {
    await setup(context);
    const backendMock = mockInitialBucketAndAgglomerateData(context, [], Store.getState());
    await context.api.data.reloadAllBuckets();
    expect(await getValueAt(context, position)).toBe(backendMock.fillValue);
    evictBucketOf(position);

    // While the bucket is requested again, another user's partial update to it is
    // incorporated. The response, for the version from before, arrives afterwards.
    const othersVoxel: Vector3 = [60, 60, 43];
    const heldRequest = holdBackFirstRequestOfBucket(
      context,
      createBucketResponseFunction(LAYERS, backendMock.fillValue, 0),
    );
    const value = getValueAt(context, othersVoxel);
    planOthersPartialUpdate(backendMock, [othersVoxel]);
    await dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    heldRequest.release();

    expect(await value).toBe(9);
    expect(heldRequest.getRequestCount()).toBe(1);
  });
});

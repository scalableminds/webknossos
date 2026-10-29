import {
  createBucketResponseFunction,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { WkDevFlags } from "viewer/api/wk_dev";
import { OrthoViews, OverwriteModeEnum, type Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  addToContourListAction,
  finishEditingAction,
  resetContourAction,
  setActiveCellAction,
  startEditingAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Model, Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In live collaboration, volume edits are saved as partial bucket updates. Until their
// save succeeds, buckets whose data arrives (again) get them re-applied (see
// unsaved_partial_updates.ts).

const VOLUME_TRACING_ID = "volumeTracingId";
const position: Vector3 = [40, 40, 43];

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
      createBucketResponseFunction({ [VOLUME_TRACING_ID]: "uint16", color: "uint8" }, 0, 0),
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

    // Neither the volume layer nor its fallback layer have data for any bucket.
    vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      async (_url: string, payload: { data: Array<unknown> }) => ({
        buffer: new ArrayBuffer(0),
        headers: {
          "empty-bucket-indices": JSON.stringify(payload.data.map((_, index) => index)),
          "failure-bucket-indices": "[]",
        },
      }),
    );
    expect(hasUnsavedPartialUpdates()).toBe(true);
    evictBucketOf(position);
    expect(await getValueAt(context, position)).toBe(5);
  });

});

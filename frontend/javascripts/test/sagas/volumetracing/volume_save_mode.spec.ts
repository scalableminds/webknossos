import { sleep } from "libs/utils";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { AnnotationCollaborationMode } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import { FillModeEnum, OrthoViews, type Vector3 } from "viewer/constants";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { setCollaborationModeAction } from "viewer/model/actions/annotation_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import {
  addToContourListAction,
  dispatchFloodfillAsync,
  finishEditingAction,
  resetContourAction,
  setActiveCellAction,
  startEditingAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Model, Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Volume edits are saved as partial bucket updates in live collaboration, where
// undo/redo is unavailable, and as whole buckets otherwise (see getVolumeSaveMode).

const VOLUME_TRACING_ID = "volumeTracingId";
const position: Vector3 = [40, 40, 43];

async function setup(
  context: WebknossosTestContext,
  mode: AnnotationCollaborationMode,
  { withoutMag1 = false } = {},
) {
  if (withoutMag1) {
    // As setupWebknossosForTestingWithRestrictions, but the volume layer starts at mag 2.
    await setupWebknossosForTesting(context, "hybrid", (data) => ({
      ...data,
      annotation: {
        ...data.annotation,
        restrictions: { ...data.annotation.restrictions, allowUpdate: true, allowSave: true },
        collaborationMode: mode,
      },
      tracings: data.tracings.map((tracing) =>
        tracing.typ === "Volume"
          ? { ...tracing, mags: tracing.mags?.filter((mag) => mag.x !== 1) }
          : tracing,
      ),
    }));
  } else {
    await setupWebknossosForTestingWithRestrictions(context, mode, true, false, "hybrid");
  }
  vi.mocked(context.mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
    createBucketResponseFunction({ [VOLUME_TRACING_ID]: "uint16", color: "uint8" }, 0, 0),
  );
  await context.api.data.reloadAllBuckets();
  Store.dispatch(updateUserSettingAction("brushSize", 10));
  Store.dispatch(setPositionAction(position));
  Store.dispatch(setToolAction(AnnotationTool.BRUSH));
  Store.dispatch(setActiveCellAction(5n));
}

function brushAt(brushPosition: Vector3) {
  Store.dispatch(startEditingAction(brushPosition, OrthoViews.PLANE_XY));
  Store.dispatch(addToContourListAction(brushPosition));
  // As handleEndForDrawOrErase does.
  Store.dispatch(finishEditingAction());
  Store.dispatch(resetContourAction());
}

// The names of the bucket actions in the save requests from `fromRequest` on.
function sentBucketActionNames(context: WebknossosTestContext, fromRequest = 0): string[] {
  return context.receivedDataPerSaveRequest
    .slice(fromRequest)
    .flatMap((entries) => entries.flatMap((entry) => entry.actions))
    .map((action) => action.name)
    .filter((name) => name === "updateBucket" || name === "updateBucketPartial");
}

// The updateBucketPartial actions in all save requests.
function sentPartialBucketUpdates(
  context: WebknossosTestContext,
): Array<{ position: Vector3; mag: Vector3 }> {
  return context.receivedDataPerSaveRequest
    .flatMap((entries) => entries.flatMap((entry) => entry.actions))
    .filter((action) => action.name === "updateBucketPartial")
    .map((action) => action.value as { position: Vector3; mag: Vector3 });
}

async function waitUntilNoOperationIsRunning() {
  await sleep(0);
  while (Store.getState().operationContext.activeOperations.length > 0) {
    await sleep(5);
  }
}

const getValue = (context: WebknossosTestContext) =>
  context.api.data.getDataValue(VOLUME_TRACING_ID, position);

describe("Volume save mode", () => {
  const previousAllowFlag = WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation;
  beforeEach(() => {
    WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation = true;
  });

  afterEach<WebknossosTestContext>(async (context) => {
    WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation = previousAllowFlag;
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("saves brush strokes as whole buckets and allows undo outside of live collaboration", async (context) => {
    await setup(context, "OwnerOnly");
    brushAt(position);
    await context.api.tracing.save();

    const names = sentBucketActionNames(context);
    expect(names).toContain("updateBucket");
    expect(names).not.toContain("updateBucketPartial");

    expect(await getValue(context)).toBe(5);
    await dispatchUndoAsync(Store.dispatch);
    expect(await getValue(context)).toBe(0);
  });

  it<WebknossosTestContext>("saves brush strokes as partial updates in live collaboration, without undo", async (context) => {
    await setup(context, "Concurrent");
    brushAt(position);
    await context.api.tracing.save();

    const names = sentBucketActionNames(context);
    expect(names).toContain("updateBucketPartial");
    expect(names).not.toContain("updateBucket");

    // No bucket is left dirty, so that none is kept from being evicted forever.
    const { cube } = Model.getSegmentationTracingLayer(VOLUME_TRACING_ID);
    expect(cube.buckets.filter((bucket) => bucket.dirty)).toEqual([]);

    // Undo is unavailable: the stroke stays.
    await dispatchUndoAsync(Store.dispatch);
    expect(await getValue(context)).toBe(5);
  });

  it<WebknossosTestContext>("doesn't send partial updates for mags the layer doesn't have", async (context) => {
    // Mag propagation runs over the dense mags, which include mag 1 here.
    await setup(context, "Concurrent", { withoutMag1: true });
    brushAt(position);
    await context.api.tracing.save();

    const sent = sentPartialBucketUpdates(context);
    expect(sent.length).toBeGreaterThan(0);
    for (const { mag } of sent) expect(mag).not.toEqual([1, 1, 1]);
  });

  it<WebknossosTestContext>("doesn't send partial updates for buckets outside of the layer", async (context) => {
    await setup(context, "Concurrent");
    // The layer starts at the origin, so the brush reaches beyond it.
    // can we do 0, 0, 0 and explain that this would cover negative coords when
    // the code wouldnt exclude out-of-layer-bounds buckets?
    brushAt([2, 2, 43]);
    await context.api.tracing.save();

    const sent = sentPartialBucketUpdates(context);
    expect(sent.length).toBeGreaterThan(0);
    for (const { position: bucketPosition } of sent) {
      expect(Math.min(...bucketPosition)).toBeGreaterThanOrEqual(0);
    }
  });

  it<WebknossosTestContext>("saves flood fills as partial updates in live collaboration", async (context) => {
    await setup(context, "Concurrent");
    brushAt(position);
    await context.api.tracing.save();
    const requestsBeforeFill = context.receivedDataPerSaveRequest.length;

    Store.dispatch(setActiveCellAction(3n));
    Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
    await dispatchFloodfillAsync(Store.dispatch, position, OrthoViews.PLANE_XY);
    await context.api.tracing.save();

    expect(await getValue(context)).toBe(3);
    const names = sentBucketActionNames(context, requestsBeforeFill);
    expect(names).toContain("updateBucketPartial");
    expect(names).not.toContain("updateBucket");
  });

  it<WebknossosTestContext>("only allows volume tools that save partial updates in live collaboration", async (context) => {
    await setup(context, "Concurrent");
    const disabledInfo = getDisabledInfoForTools(Store.getState());
    const isDisabledForLiveCollaboration = (tool: AnnotationTool) =>
      disabledInfo[tool.id].explanation.includes("simultaneous editing");

    for (const tool of [
      AnnotationTool.BRUSH,
      AnnotationTool.ERASE_BRUSH,
      AnnotationTool.FILL_CELL,
    ]) {
      expect(isDisabledForLiveCollaboration(tool), tool.id).toBe(false);
    }
    for (const tool of [
      AnnotationTool.TRACE,
      AnnotationTool.ERASE_TRACE,
      AnnotationTool.QUICK_SELECT,
    ]) {
      expect(isDisabledForLiveCollaboration(tool), tool.id).toBe(true);
    }
    // labelVoxels saves whole buckets, too.
    expect(() => context.api.data.labelVoxels([position], 5n)).toThrow();

    WkDevFlags.liveCollaboration.allowCollaborativeVolumeAnnotation = false;
    // getDisabledInfoForTools is memoized on the state.
    Store.dispatch(updateUserSettingAction("brushSize", 11));
    const disabledInfoWithoutFlag = getDisabledInfoForTools(Store.getState());
    expect(disabledInfoWithoutFlag[AnnotationTool.BRUSH.id].isDisabled).toBe(true);
  });

  it<WebknossosTestContext>("saves pending whole buckets before live collaboration starts and discards the undo history", async (context) => {
    await setup(context, "OwnerOnly");
    // The stroke's buckets are still in the push queue, which saves them debounced.
    brushAt(position);
    Store.dispatch(setCollaborationModeAction("Concurrent"));
    await waitUntilNoOperationIsRunning();

    const { pushQueue } = Model.getSegmentationTracingLayer(VOLUME_TRACING_ID);
    expect(pushQueue.stateSaved()).toBe(true);
    expect(sentBucketActionNames(context)).toContain("updateBucket");

    // From now on, strokes are saved as partial updates.
    const requestsBeforeStroke = context.receivedDataPerSaveRequest.length;
    Store.dispatch(setActiveCellAction(7n));
    brushAt(position);
    await context.api.tracing.save();
    const names = sentBucketActionNames(context, requestsBeforeStroke);
    expect(names).toContain("updateBucketPartial");
    expect(names).not.toContain("updateBucket");

    // Back outside of live collaboration, the earlier strokes cannot be undone. Several
    // undos, because the strokes' segment changes have undo entries of their own.
    Store.dispatch(setCollaborationModeAction("OwnerOnly"));
    for (let i = 0; i < 3; i++) {
      await dispatchUndoAsync(Store.dispatch);
    }
    expect(await getValue(context)).toBe(7);
  });
});

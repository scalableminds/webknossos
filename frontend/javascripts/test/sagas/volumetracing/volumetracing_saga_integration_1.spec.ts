/*
 * Also have a look at the sibling module volumetracing_saga_integration_2.spec.ts.
 * The tests are split into two modules to allow for isolated parallelization and thus
 * increased performance.
 */
import "test/sagas/saga_integration.mock";
import _ from "lodash";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { ContourModeEnum, OrthoViews, OverwriteModeEnum, type Vector3 } from "viewer/constants";
import {
  setupWebknossosForTesting,
  createBucketResponseFunction,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { restartSagaAction, wkReadyAction } from "viewer/model/actions/actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import Store from "viewer/store";
import dummyUser from "test/fixtures/dummy_user";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import {
  batchUpdateGroupsAndSegmentsAction,
  clickSegmentAction,
  removeSegmentAction,
  setSegmentGroupsAction,
  updateSegmentAction,
  setActiveCellAction,
  addToLayerAction,
  startEditingAction,
  finishEditingAction,
  setContourTracingModeAction,
} from "viewer/model/actions/volumetracing_actions";
import { MISSING_GROUP_ID } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchUndoAsync,
  dispatchRedoAsync,
  discardSaveQueuesAction,
} from "viewer/model/actions/save_actions";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";

describe("Volume Tracing", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    // Setup Webknossos
    // this will execute model.fetch(...) and initialize the store with the tracing, etc.
    Store.dispatch(restartSagaAction());
    Store.dispatch(discardSaveQueuesAction());
    Store.dispatch(setActiveUserAction(dummyUser));

    await setupWebknossosForTesting(context, "volume");

    // Ensure the slow compression is disabled by default. Tests may change
    // this individually.
    context.setSlowCompression(false);
    // Dispatch the wkReadyAction, so the sagas are started
    Store.dispatch(wkReadyAction());
  });

  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    // Saving after each test and checking that the root saga didn't crash,
    // ensures that each test is cleanly exited. Without it weird output can
    // occur (e.g., a promise gets resolved which interferes with the next test).
    await context.api.tracing.save();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it<WebknossosTestContext>("Brushing with undo and garbage collection", async ({ api, mocks }) => {
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const paintCenter = [0, 0, 0] as Vector3;
    const brushSize = 10;
    const newCellId = 2;
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationTool.BRUSH));
    // Brush with ${newCellId}
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    // Brush with ${newCellId + 1}
    Store.dispatch(setActiveCellAction(newCellId + 1));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    expect(
      await api.data.getDataValue(volumeTracingLayerName, paintCenter),
      "Before undo, there should be newCellId + 1",
    ).toBe(newCellId + 1);

    await api.tracing.save();

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, newCellId + 1, 500),
    );

    const cube = api.data.model.getCubeByLayerName(volumeTracingLayerName);
    cube.collectAllBuckets();

    await dispatchUndoAsync(Store.dispatch);

    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId);

    await dispatchRedoAsync(Store.dispatch);
    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId + 1);
  });

  it<WebknossosTestContext>("Brushing/Tracing with upsampling to unloaded data", async ({
    api,
    mocks,
  }) => {
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );

    Store.dispatch(setZoomStepAction(4));
    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const paintCenter = [0, 0, 0] as Vector3;
    const brushSize = 16;
    const newCellId = 2;

    Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_EMPTY));
    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationTool.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    await api.tracing.save();

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(
        await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep),
        `Center should still have old value at zoomstep=${zoomStep}`,
      ).toBe(oldCellId);
    }
  });

  it<WebknossosTestContext>("Erasing on mag 4 where mag 1 is unloaded", async (context) => {
    await eraseInMag4Helper(context, false);
  });

  it<WebknossosTestContext>("Erasing on mag 4 where mag 1 is loaded", async (context) => {
    await eraseInMag4Helper(context, true);
  });

  async function eraseInMag4Helper(context: WebknossosTestContext, loadDataAtBeginning: boolean) {
    const { mocks, api } = context;
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );

    Store.dispatch(setZoomStepAction(4));

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const paintCenter = [0, 0, 0] as Vector3;
    // This particular brushSize used to trigger a bug. It should not be changed.
    const brushSize = 263;

    if (loadDataAtBeginning) {
      for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
        expect(
          await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep),
          `Center should have old value at zoomstep=${zoomStep}`,
        ).toBe(oldCellId);
      }
    }

    Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
    Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationTool.ERASE_BRUSH));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    await api.tracing.save();
    const data = await api.data.getDataForBoundingBox(volumeTracingLayerName, {
      min: [0, 0, 0],
      max: [35, 1, 1],
    });

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await api.data.getDataValue(volumeTracingLayerName, [32, 0, 0], zoomStep);
      expect(readValue, `Voxel should be erased at zoomstep=${zoomStep}`).toBe(0);
    }

    // @ts-ignore
    expect(_.max(data), "All the data should be 0 (== erased).").toBe(0);
  }

  it<WebknossosTestContext>("Undo erasing in mag 4 (load before undo)", async (context) => {
    return await undoEraseInMag4Helper(context, false);
  });

  it<WebknossosTestContext>("Undo erasing in mag 4 (load after undo)", (context) => {
    return undoEraseInMag4Helper(context, true);
  });

  async function undoEraseInMag4Helper(context: WebknossosTestContext, loadBeforeUndo: boolean) {
    const { mocks, api } = context;
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );

    Store.dispatch(setZoomStepAction(4));

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const paintCenter = [0, 0, 0] as Vector3;
    const brushSize = 10;

    Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
    Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationTool.ERASE_BRUSH));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    if (loadBeforeUndo) {
      for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
        const readValue = await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep);
        expect(readValue, `Voxel should be erased at zoomstep=${zoomStep}`).toBe(0);
      }
    }

    await dispatchUndoAsync(Store.dispatch);

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep);
      expect(readValue, `After undo, voxel should have old value at zoomstep=${zoomStep}`).toBe(
        oldCellId,
      );
    }
  }

  it<WebknossosTestContext>("Provoke race condition when bucket compression is very slow", async ({
    api,
    mocks,
    setSlowCompression,
  }) => {
    setSlowCompression(true);
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );
    Store.dispatch(setZoomStepAction(4));
    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const paintCenter = [0, 0, 0] as Vector3;
    const brushSize = 10;

    Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
    Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationTool.ERASE_BRUSH));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep);
      expect(readValue, `Voxel should be erased at zoomstep=${zoomStep}`).toBe(0);
    }

    await dispatchUndoAsync(Store.dispatch);

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep);
      expect(readValue, `After undo, voxel should have old value at zoomstep=${zoomStep}`).toBe(
        oldCellId,
      );
    }

    await dispatchRedoAsync(Store.dispatch);

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep);
      expect(readValue, `Voxel should be erased at zoomstep=${zoomStep}`).toBe(0);
    }
  });

  it<WebknossosTestContext>("Undo for deleting segment group (without recursion)", async ({
    api,
  }) => {
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const position = [1, 2, 3] as Vector3;

    Store.dispatch(clickSegmentAction(1, position, undefined));
    Store.dispatch(clickSegmentAction(2, position, undefined));
    Store.dispatch(clickSegmentAction(3, position, undefined));
    Store.dispatch(clickSegmentAction(4, position, undefined));

    Store.dispatch(
      setSegmentGroupsAction(
        [
          { name: "Group 1", groupId: 1, children: [] },
          { name: "Group 2", groupId: 2, children: [] },
        ],
        volumeTracingLayerName,
      ),
    );

    Store.dispatch(updateSegmentAction(1, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(2, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(3, { groupId: 2 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(4, { groupId: 2 }, volumeTracingLayerName));

    Store.dispatch(
      batchUpdateGroupsAndSegmentsAction([
        updateSegmentAction(1, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(2, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(3, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(4, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        setSegmentGroupsAction([], volumeTracingLayerName),
      ]),
    );

    const state = Store.getState();
    const tracing = state.annotation.volumes[0];
    expect(tracing.segmentGroups.length).toBe(0);
    expect(tracing.segments.size()).toBe(4);

    for (const segment of tracing.segments.values()) {
      expect(segment.groupId).toBe(null);
    }

    await dispatchUndoAsync(Store.dispatch);

    const stateRestored = Store.getState();
    const tracingRestored = stateRestored.annotation.volumes[0];
    expect(tracingRestored.segmentGroups.length).toBe(2);
    expect(tracingRestored.segments.size()).toBe(4);

    expect(tracingRestored.segments.getOrThrow(1).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(2).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(3).groupId).toBe(2);
    expect(tracingRestored.segments.getOrThrow(4).groupId).toBe(2);
  });

  it<WebknossosTestContext>("Undo for deleting segment group (with recursion)", async ({ api }) => {
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const position = [1, 2, 3] as Vector3;

    Store.dispatch(clickSegmentAction(1, position, undefined));
    Store.dispatch(clickSegmentAction(2, position, undefined));
    Store.dispatch(clickSegmentAction(3, position, undefined));
    Store.dispatch(clickSegmentAction(4, position, undefined));

    Store.dispatch(
      setSegmentGroupsAction(
        [
          {
            name: "Group 1",
            groupId: 1,
            children: [{ name: "Group 2", groupId: 2, children: [] }],
          },
        ],
        volumeTracingLayerName,
      ),
    );

    Store.dispatch(updateSegmentAction(1, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(2, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(3, { groupId: 2 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(4, { groupId: 2 }, volumeTracingLayerName));

    Store.dispatch(
      batchUpdateGroupsAndSegmentsAction([
        removeSegmentAction(1, volumeTracingLayerName),
        removeSegmentAction(2, volumeTracingLayerName),
        removeSegmentAction(3, volumeTracingLayerName),
        removeSegmentAction(4, volumeTracingLayerName),
        setSegmentGroupsAction([], volumeTracingLayerName),
      ]),
    );

    const state = Store.getState();
    const tracing = state.annotation.volumes[0];
    expect(tracing.segmentGroups.length).toBe(0);
    expect(tracing.segments.size()).toBe(0);

    await dispatchUndoAsync(Store.dispatch);

    const stateRestored = Store.getState();
    const tracingRestored = stateRestored.annotation.volumes[0];
    expect(tracingRestored.segmentGroups.length).toBe(1);
    expect(tracingRestored.segmentGroups[0]?.children.length || 0).toBe(1);
    expect(tracingRestored.segments.size()).toBe(4);

    expect(tracingRestored.segments.getOrThrow(1).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(2).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(3).groupId).toBe(2);
    expect(tracingRestored.segments.getOrThrow(4).groupId).toBe(2);
  });

  it<WebknossosTestContext>("Undo for deleting segment group (bug repro)", async ({ api }) => {
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    const position = [1, 2, 3] as Vector3;

    Store.dispatch(clickSegmentAction(1, position, undefined));
    Store.dispatch(clickSegmentAction(2, position, undefined));
    Store.dispatch(clickSegmentAction(3, position, undefined));
    Store.dispatch(clickSegmentAction(4, position, undefined));

    /* Set up
    Group 1
      Segment 1
      Segment 2
    Group 2
      Segment 3
      Segment 4
    */
    Store.dispatch(
      setSegmentGroupsAction(
        [
          { name: "Group 1", groupId: 1, children: [] },
          { name: "Group 2", groupId: 2, children: [] },
        ],
        volumeTracingLayerName,
      ),
    );

    Store.dispatch(updateSegmentAction(1, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(2, { groupId: 1 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(3, { groupId: 2 }, volumeTracingLayerName));
    Store.dispatch(updateSegmentAction(4, { groupId: 2 }, volumeTracingLayerName));

    expect(Store.getState().annotation.volumes[0].segmentGroups.length).toBe(2);

    // Delete everything
    Store.dispatch(
      batchUpdateGroupsAndSegmentsAction([
        removeSegmentAction(1, volumeTracingLayerName),
        removeSegmentAction(2, volumeTracingLayerName),
        removeSegmentAction(3, volumeTracingLayerName),
        removeSegmentAction(4, volumeTracingLayerName),
        setSegmentGroupsAction([], volumeTracingLayerName),
      ]),
    );

    const state = Store.getState();
    const tracing = state.annotation.volumes[0];
    expect(tracing.segmentGroups.length).toBe(0);
    expect(tracing.segments.size()).toBe(0);

    // Undo again
    await dispatchUndoAsync(Store.dispatch);

    expect(Store.getState().annotation.volumes[0].segmentGroups.length).toBe(2);

    // Delete without recursion
    Store.dispatch(
      batchUpdateGroupsAndSegmentsAction([
        updateSegmentAction(1, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(2, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(3, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        updateSegmentAction(4, { groupId: MISSING_GROUP_ID }, volumeTracingLayerName),
        setSegmentGroupsAction([], volumeTracingLayerName),
      ]),
    );

    await dispatchUndoAsync(Store.dispatch);

    const stateRestored = Store.getState();
    const tracingRestored = stateRestored.annotation.volumes[0];
    expect(tracingRestored.segments.size()).toBe(4);
    expect(tracingRestored.segmentGroups.length).toBe(2);

    expect(tracingRestored.segments.getOrThrow(1).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(2).groupId).toBe(1);
    expect(tracingRestored.segments.getOrThrow(3).groupId).toBe(2);
    expect(tracingRestored.segments.getOrThrow(4).groupId).toBe(2);
  });
});

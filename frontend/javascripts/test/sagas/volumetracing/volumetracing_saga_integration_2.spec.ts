import "test/sagas/saga_integration.mock";
import { V3 } from "libs/mjs";
import Constants, {
  AnnotationToolEnum,
  ContourModeEnum,
  FillModeEnum,
  OrthoViews,
  OverwriteModeEnum,
  type Vector3,
} from "oxalis/constants";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import { setPositionAction, setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import {
  discardSaveQueuesAction,
  dispatchRedoAsync,
  dispatchUndoAsync,
} from "oxalis/model/actions/save_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import {
  addToLayerAction,
  dispatchFloodfillAsync,
  finishEditingAction,
  setActiveCellAction,
  setContourTracingModeAction,
  startEditingAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import Store from "oxalis/store";
import dummyUser from "test/fixtures/dummy_user";
import {
  __setupWebknossos,
  createBucketResponseFunction,
  type SetupWebknossosTestContext,
} from "test/helpers/apiHelpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Volume Tracing", () => {
  beforeEach<SetupWebknossosTestContext>(async (context) => {
    // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
    Store.dispatch(restartSagaAction());
    Store.dispatch(discardSaveQueuesAction());
    Store.dispatch(setActiveUserAction(dummyUser));

    await __setupWebknossos(context, "volume");

    // Ensure the slow compression is disabled by default. Tests may change
    // this individually.
    context.setSlowCompression(false);
    // Dispatch the wkReadyAction, so the sagas are started
    Store.dispatch(wkReadyAction());
  });

  afterEach<SetupWebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    // Saving after each test and checking that the root saga didn't crash,
    // ensures that each test is cleanly exited. Without it weird output can
    // occur (e.g., a promise gets resolved which interferes with the next test).
    await context.api.tracing.save();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it<SetupWebknossosTestContext>("Executing a floodfill in mag 1", async ({ api, mocks }) => {
    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, 0),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const paintCenter = [0, 0, 43] as Vector3;
    const brushSize = 10;
    const newCellId = 2;

    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 43]));
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep)).toBe(
        newCellId,
      );
      // A brush size of 10 means a radius of 5 (so, from 0 to 4).
      expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep)).toBe(
        newCellId,
      );
      // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
      // (and not at 4,4)
      expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep)).toBe(
        newCellId,
      );
    }

    await api.tracing.save();
    const floodingCellId = 3;

    Store.dispatch(setActiveCellAction(floodingCellId));
    Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
    await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep)).toBe(
        floodingCellId,
      );
      // A brush size of 10 means a radius of 5 (so, from 0 to 4).
      expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep)).toBe(
        floodingCellId,
      );
      // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
      // (and not at 4,4)
      expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(
        await api.data.getDataForBoundingBox(volumeTracingLayerName, {
          min: [32, 32, 32],
          max: [64, 64, 64],
        }),
      ).toMatchSnapshot();
    }
  });

  it<SetupWebknossosTestContext>("Executing a floodfill in mag 2", async ({ api, mocks }) => {
    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, 0),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const paintCenter = [0, 0, 43] as Vector3;
    const brushSize = 10;
    const newCellId = 2;

    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 43]));
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep)).toBe(
        newCellId,
      );
      // A brush size of 10 means a radius of 5 (so, from 0 to 4).
      expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep)).toBe(
        newCellId,
      );
      // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
      // (and not at 4,4)
      expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep)).toBe(
        newCellId,
      );
    }

    await api.tracing.save();
    const floodingCellId = 3;
    Store.dispatch(setActiveCellAction(floodingCellId));
    Store.dispatch(setZoomStepAction(2));
    Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
    await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep)).toBe(
        floodingCellId,
      );
      // A brush size of 10 means a radius of 5 (so, from 0 to 4).
      expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep)).toBe(
        floodingCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep)).toBe(
        floodingCellId,
      );
      // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
      // (and not at 4,4)
      expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep)).toBe(
        floodingCellId,
      );
    }
  });

  it<SetupWebknossosTestContext>("Executing a floodfill in mag 1 (long operation)", async ({
    api,
    mocks,
  }) => {
    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, 0),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();
    const paintCenter = [128, 128, 128] as Vector3;

    Store.dispatch(setPositionAction(paintCenter));

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, 0)).toBe(0);

    const floodingCellId = 3;
    Store.dispatch(setActiveCellAction(floodingCellId));
    Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
    await dispatchFloodfillAsync(Store.dispatch, paintCenter, OrthoViews.PLANE_XY);

    const EXPECTED_HALF_EXTENT = V3.scale(Constants.FLOOD_FILL_EXTENTS[FillModeEnum._3D], 0.5);

    async function assertFloodFilledState() {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, 0)).toBe(
        floodingCellId,
      );
      expect(hasRootSagaCrashed()).toBe(false);

      const cuboidData = await api.data.getDataForBoundingBox(volumeTracingLayerName, {
        min: V3.sub(paintCenter, EXPECTED_HALF_EXTENT),
        max: V3.add(paintCenter, EXPECTED_HALF_EXTENT),
      });

      // There should be no item which does not equal floodingCellId
      expect(cuboidData.findIndex((el) => el !== floodingCellId)).toBe(-1);
    }

    async function assertInitialState() {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, 0)).toBe(0);
      expect(hasRootSagaCrashed()).toBe(false);

      const cuboidData = await api.data.getDataForBoundingBox(volumeTracingLayerName, {
        min: [0, 0, 0],
        max: [256, 256, 256],
      });
      // There should be no non-zero item
      expect(cuboidData.findIndex((el) => el !== 0)).toBe(-1);
    }

    // Assert state after flood-fill
    await assertFloodFilledState();
    // Undo [the bounding box created by the flood fill] and [the flood fill itself] and assert initial state.
    await dispatchUndoAsync(Store.dispatch);
    await dispatchUndoAsync(Store.dispatch);
    await assertInitialState();
    // Reload all buckets, "redo" and assert flood-filled state
    api.data.reloadAllBuckets();
    await dispatchRedoAsync(Store.dispatch);
    await assertFloodFilledState();
    // Reload all buckets, "undo" and assert flood-filled state
    api.data.reloadAllBuckets();
    await dispatchUndoAsync(Store.dispatch);
    await assertInitialState();
    // "Redo", reload all buckets and assert flood-filled state
    await dispatchRedoAsync(Store.dispatch);
    api.data.reloadAllBuckets();
    await assertFloodFilledState();
    // "Undo", reload all buckets and assert flood-filled state
    await dispatchUndoAsync(Store.dispatch);
    api.data.reloadAllBuckets();
    await assertInitialState();
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with a new segment id should update the bucket data", async ({
    api,
    mocks,
  }) => {
    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, 0, 0),
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
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 0], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 0], zoomStep)).toBe(
        newCellId,
      );
      // A brush size of 10 means a radius of 5 (so, from 0 to 4).
      expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 0], zoomStep)).toBe(
        newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 0], zoomStep)).toBe(
        newCellId,
      );
      // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
      // (and not at 4,4)
      expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 0], zoomStep)).toBe(
        newCellId,
      );
      // In mag 1 and mag 2,
      expect(await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0], zoomStep)).toBe(
        zoomStep === 0 ? 0 : newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 5, 0], zoomStep)).toBe(
        zoomStep === 0 ? 0 : newCellId,
      );
      expect(await api.data.getDataValue(volumeTracingLayerName, [0, 0, 1], zoomStep)).toBe(
        zoomStep === 0 ? 0 : newCellId,
      );
    }

    expect(
      await api.data.getDataForBoundingBox(volumeTracingLayerName, {
        min: [0, 0, 0],
        max: [32, 32, 32],
      }),
    ).toMatchSnapshot();
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with already existing backend data", async ({
    api,
    mocks,
  }) => {
    const paintCenter = [0, 0, 0] as Vector3;
    const brushSize = 10;
    const newCellId = 2;
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 0),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];
    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(oldCellId);

    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0])).toBe(newCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [0, 1, 0])).toBe(newCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [1, 1, 0])).toBe(newCellId);
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    expect(await api.data.getDataValue(volumeTracingLayerName, [4, 0, 0])).toBe(newCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [0, 4, 0])).toBe(newCellId);
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    expect(await api.data.getDataValue(volumeTracingLayerName, [3, 3, 0])).toBe(newCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0])).toBe(oldCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [0, 5, 0])).toBe(oldCellId);
    expect(await api.data.getDataValue(volumeTracingLayerName, [0, 0, 1])).toBe(oldCellId);
    expect(
      await api.data.getDataForBoundingBox(volumeTracingLayerName, {
        min: [0, 0, 0],
        max: [32, 32, 32],
      }),
    ).toMatchSnapshot();
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ia i)", async (context) => {
    await undoTestHelper(context, false, false);
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ia ii)", async (context) => {
    await undoTestHelper(context, true, false);
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ia iii)", async (context) => {
    await undoTestHelper(context, false, true);
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ia iv)", async (context) => {
    await undoTestHelper(context, true, true);
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ib)", async (context) => {
    await testBrushingWithUndo(context, true);
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (Ic)", async (context) => {
    await testBrushingWithUndo(context, false);
  });

  async function undoTestHelper(
    context: SetupWebknossosTestContext,
    assertBeforeUndo: boolean,
    assertAfterUndo: boolean,
  ) {
    const { mocks, api } = context;
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
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
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

    if (assertBeforeUndo) {
      expect(
        await api.data.getDataValue(volumeTracingLayerName, paintCenter),
        "Before undo, there should be newCellId + 1",
      ).toBe(newCellId + 1);
      expect(
        await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]),
        "Before undo, there should be newCellId + 1",
      ).toBe(newCellId + 1);
      expect(
        await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]),
        "Before undo, there should be oldCellId",
      ).toBe(oldCellId);
    }

    await dispatchUndoAsync(Store.dispatch);

    if (assertAfterUndo) {
      expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId);
      expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0])).toBe(newCellId);
      expect(await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0])).toBe(oldCellId);
    }

    await dispatchRedoAsync(Store.dispatch);
    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId + 1);
    expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0])).toBe(newCellId + 1);
    expect(await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0])).toBe(oldCellId);
  }

  async function testBrushingWithUndo(
    context: SetupWebknossosTestContext,
    assertBeforeRedo: boolean,
  ) {
    const { mocks, api } = context;
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 500),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const paintCenter = [3000, 0, 0] as Vector3;
    const brushSize = 10;
    const newCellId = 2;
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

    Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
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
    // Erase everything
    Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
    Store.dispatch(setToolAction(AnnotationToolEnum.ERASE_BRUSH));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    // Undo erasure
    await dispatchUndoAsync(Store.dispatch);

    const cube = api.data.model.getCubeByLayerName(volumeTracingLayerName);
    const problematicBucket = cube.getOrCreateBucket([93, 0, 0, 0]) as DataBucket;
    expect(problematicBucket.needsBackendData()).toBe(true);

    if (assertBeforeRedo) {
      expect(
        await api.data.getDataValue(volumeTracingLayerName, paintCenter),
        "After erase + undo",
      ).toBe(newCellId + 1);
      expect(
        await api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [1, 0, 0])),
        "After erase + undo",
      ).toBe(newCellId + 1);
      expect(
        await api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [5, 0, 0])),
        "After erase + undo",
      ).toBe(oldCellId);
    }

    // Redo erasure
    await dispatchRedoAsync(Store.dispatch);

    if (assertBeforeRedo) {
      expect(problematicBucket.needsBackendData()).toBe(false);
    } else {
      expect(problematicBucket.needsBackendData()).toBe(true);
    }

    expect(
      await api.data.getDataValue(volumeTracingLayerName, paintCenter),
      "After erase + undo + redo",
    ).toBe(0);
    expect(
      await api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [1, 0, 0])),
      "After erase + undo + redo",
    ).toBe(0);
    expect(
      await api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [5, 0, 0])),
      "After erase + undo + redo",
    ).toBe(oldCellId);
  }

  it<SetupWebknossosTestContext>("Brushing/Tracing with undo (II)", async ({ api, mocks }) => {
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

    Store.dispatch(updateUserSettingAction("brushSize", brushSize));
    Store.dispatch(setPositionAction([0, 0, 0]));
    Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    Store.dispatch(setActiveCellAction(newCellId + 1));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());
    Store.dispatch(setActiveCellAction(newCellId + 2));
    Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintCenter));
    Store.dispatch(finishEditingAction());

    await dispatchUndoAsync(Store.dispatch);
    const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

    expect(await api.data.getDataValue(volumeTracingLayerName, paintCenter)).toBe(newCellId + 1);
    expect(await api.data.getDataValue(volumeTracingLayerName, [1, 0, 0])).toBe(newCellId + 1);
    expect(await api.data.getDataValue(volumeTracingLayerName, [5, 0, 0])).toBe(oldCellId);
  });
});

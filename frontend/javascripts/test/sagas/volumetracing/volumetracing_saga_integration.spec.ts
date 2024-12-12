/* eslint-disable no-await-in-loop */
import "test/sagas/saga_integration.mock";
import _ from "lodash";
import Constants, {
  AnnotationToolEnum,
  ContourModeEnum,
  FillModeEnum,
  OrthoViews,
  OverwriteModeEnum,
  type Vector3,
} from "oxalis/constants";
import { __setupOxalis, createBucketResponseFunction } from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Store from "oxalis/store";
import mockRequire from "mock-require";
import anyTest, { type ExecutionContext, type TestFn } from "ava";
import { V3 } from "libs/mjs";
import dummyUser from "test/fixtures/dummy_user";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import {
  batchUpdateGroupsAndSegmentsAction,
  clickSegmentAction,
  removeSegmentAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { ModelType } from "oxalis/model";
import type { RequestType } from "libs/request";
import type { ApiInterface } from "oxalis/api/api_latest";
import type { DataBucket } from "oxalis/model/bucket_data_handling/bucket";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";

//

const { dispatchUndoAsync, dispatchRedoAsync, discardSaveQueuesAction } = mockRequire.reRequire(
  "oxalis/model/actions/save_actions",
);
const {
  setActiveCellAction,
  addToLayerAction,
  dispatchFloodfillAsync,
  startEditingAction,
  finishEditingAction,
  setContourTracingModeAction,
} = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");
const { setPositionAction, setZoomStepAction } = mockRequire.reRequire(
  "oxalis/model/actions/flycam_actions",
);
const { setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");

// Ava's recommendation for Typescript types
// https://github.com/avajs/ava/blob/main/docs/recipes/typescript.md#typing-tcontext
type Context = {
  model: ModelType;
  mocks: {
    Request: RequestType;
  };
  setSlowCompression: (b: boolean) => void;
  api: ApiInterface;
};
const test = anyTest as TestFn<Context>;

test.beforeEach(async (t) => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  Store.dispatch(setActiveUserAction(dummyUser));
  await __setupOxalis(t, "volume");
  // Ensure the slow compression is disabled by default. Tests may change
  // this individually.
  t.context.setSlowCompression(false);
  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});
test.afterEach(async (t) => {
  // Saving after each test and checking that the root saga didn't crash,
  // ensures that each test is cleanly exited. Without it weird output can
  // occur (e.g., a promise gets resolved which interferes with the next test).
  await t.context.api.tracing.save();
  t.false(hasRootSagaCrashed());
});
test.serial("Executing a floodfill in mag 1", async (t) => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
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
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep),
      newCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep),
      newCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep),
      newCellId,
    );
  }

  await t.context.api.tracing.save();
  const floodingCellId = 3;
  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
  await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep),
      floodingCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep),
      floodingCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep),
      floodingCellId,
    );
    t.snapshot(
      await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
        min: [32, 32, 32],
        max: [64, 64, 64],
      }),
    );
  }
});
test.serial("Executing a floodfill in mag 2", async (t) => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
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
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep),
      newCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep),
      newCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep),
      newCellId,
    );
  }

  await t.context.api.tracing.save();
  const floodingCellId = 3;
  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(setZoomStepAction(2));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
  await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 43], zoomStep),
      floodingCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 43], zoomStep),
      floodingCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 43], zoomStep),
      floodingCellId,
    );
  }
});

test.serial("Executing a floodfill in mag 1 (long operation)", async (t) => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const paintCenter = [128, 128, 128] as Vector3;
  Store.dispatch(setPositionAction(paintCenter));
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0), 0);
  const floodingCellId = 3;
  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
  await dispatchFloodfillAsync(Store.dispatch, paintCenter, OrthoViews.PLANE_XY);

  const EXPECTED_HALF_EXTENT = V3.scale(Constants.FLOOD_FILL_EXTENTS[FillModeEnum._3D], 0.5);

  async function assertFloodFilledState() {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0),
      floodingCellId,
    );
    t.false(hasRootSagaCrashed());
    const cuboidData = await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
      min: V3.sub(paintCenter, EXPECTED_HALF_EXTENT),
      max: V3.add(paintCenter, EXPECTED_HALF_EXTENT),
    });
    // There should be no item which does not equal floodingCellId
    t.is(
      cuboidData.findIndex((el) => el !== floodingCellId),
      -1,
    );
  }

  async function assertInitialState() {
    t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0), 0);
    t.false(hasRootSagaCrashed());
    const cuboidData = await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
      min: [0, 0, 0],
      max: [256, 256, 256],
    });
    // There should be no non-zero item
    t.is(
      cuboidData.findIndex((el) => el !== 0),
      -1,
    );
  }

  // Assert state after flood-fill
  await assertFloodFilledState();
  // Undo [the bounding box created by the flood fill] and [the flood fill itself] and assert initial state.
  await dispatchUndoAsync(Store.dispatch);
  await dispatchUndoAsync(Store.dispatch);
  await assertInitialState();
  // Reload all buckets, "redo" and assert flood-filled state
  t.context.api.data.reloadAllBuckets();
  await dispatchRedoAsync(Store.dispatch);
  await assertFloodFilledState();
  // Reload all buckets, "undo" and assert flood-filled state
  t.context.api.data.reloadAllBuckets();
  await dispatchUndoAsync(Store.dispatch);
  await assertInitialState();
  // "Redo", reload all buckets and assert flood-filled state
  await dispatchRedoAsync(Store.dispatch);
  t.context.api.data.reloadAllBuckets();
  await assertFloodFilledState();
  // "Undo", reload all buckets and assert flood-filled state
  await dispatchUndoAsync(Store.dispatch);
  t.context.api.data.reloadAllBuckets();
  await assertInitialState();
});

test.serial("Brushing/Tracing with a new segment id should update the bucket data", async (t) => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 10;
  const newCellId = 2;
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 0], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 0], zoomStep),
      newCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 0], zoomStep),
      newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 0], zoomStep),
      newCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 0], zoomStep),
      newCellId,
    );
    // In mag 1 and mag 2,
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 5, 0], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 0, 1], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
  }

  t.snapshot(
    await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
      min: [0, 0, 0],
      max: [32, 32, 32],
    }),
  );
});
test.serial("Brushing/Tracing with already existing backend data", async (t) => {
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 10;
  const newCellId = 2;
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter), oldCellId);
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter), newCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 1, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 1, 0]), newCellId);
  // A brush size of 10 means a radius of 5 (so, from 0 to 4).
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [4, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 4, 0]), newCellId);
  // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
  // (and not at 4,4)
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [3, 3, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]), oldCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 5, 0]), oldCellId);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 0, 1]), oldCellId);
  t.snapshot(
    await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
      min: [0, 0, 0],
      max: [32, 32, 32],
    }),
  );
});
// The binary parameters control whether the test will assert additional
// constraints in between. Since getDataValue() has the side effect of awaiting
// the loaded bucket, the test hits different execution paths. For example,
// older code failed for test ii and and iv.
test.serial("Brushing/Tracing with undo (Ia i)", undoTestHelper, false, false);
test.serial("Brushing/Tracing with undo (Ia ii)", undoTestHelper, true, false);
test.serial("Brushing/Tracing with undo (Ia iii)", undoTestHelper, false, true);
test.serial("Brushing/Tracing with undo (Ia iv)", undoTestHelper, true, true);
test.serial("Brushing/Tracing with undo (Ib)", testBrushingWithUndo, true);
test.serial("Brushing/Tracing with undo (Ic)", testBrushingWithUndo, false);

async function undoTestHelper(
  t: ExecutionContext<Context>,
  assertBeforeUndo: boolean,
  assertAfterUndo: boolean,
) {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 10;
  const newCellId = 2;
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
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
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter),
      newCellId + 1,
      "Before undo, there should be newCellId + 1",
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]),
      newCellId + 1,
      "Before undo, there should be newCellId + 1",
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]),
      oldCellId,
      "Before undo, there should be oldCellId",
    );
  }

  await dispatchUndoAsync(Store.dispatch);

  if (assertAfterUndo) {
    t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter), newCellId);
    t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]), newCellId);
    t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]), oldCellId);
  }

  await dispatchRedoAsync(Store.dispatch);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter), newCellId + 1);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]), newCellId + 1);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]), oldCellId);
}

async function testBrushingWithUndo(t: ExecutionContext<Context>, assertBeforeRedo: boolean) {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const paintCenter = [3000, 0, 0] as Vector3;
  const brushSize = 10;
  const newCellId = 2;
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
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
  const cube = t.context.api.data.model.getCubeByLayerName(volumeTracingLayerName);
  const problematicBucket = cube.getOrCreateBucket([93, 0, 0, 0]) as DataBucket;
  t.true(problematicBucket.needsBackendData());

  if (assertBeforeRedo) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter),
      newCellId + 1,
      "After erase + undo",
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [1, 0, 0])),
      newCellId + 1,
      "After erase + undo",
    );
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [5, 0, 0])),
      oldCellId,
      "After erase + undo",
    );
  }

  // Redo erasure
  await dispatchRedoAsync(Store.dispatch);

  if (assertBeforeRedo) {
    t.false(problematicBucket.needsBackendData());
  } else {
    t.true(problematicBucket.needsBackendData());
  }

  t.is(
    await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter),
    0,
    "After erase + undo + redo",
  );
  t.is(
    await t.context.api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [1, 0, 0])),
    0,
    "After erase + undo + redo",
  );
  t.is(
    await t.context.api.data.getDataValue(volumeTracingLayerName, V3.add(paintCenter, [5, 0, 0])),
    oldCellId,
    "After erase + undo + redo",
  );
}

test.serial("Brushing/Tracing with undo (II)", async (t) => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
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
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter), newCellId + 1);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [1, 0, 0]), newCellId + 1);
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, [5, 0, 0]), oldCellId);
});
test.serial("Brushing/Tracing with upsampling to unloaded data", async (t) => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  Store.dispatch(setZoomStepAction(4));
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 16;
  const newCellId = 2;
  Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_EMPTY));
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.BRUSH));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());
  await t.context.api.tracing.save();

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep),
      oldCellId,
      `Center should still have old value at zoomstep=${zoomStep}`,
    );
  }
});
test.serial("Erasing on mag 4 where mag 1 is unloaded", eraseInMag4Helper, false);
test.serial("Erasing on mag 4 where mag 1 is loaded", eraseInMag4Helper, true);

async function eraseInMag4Helper(t: ExecutionContext<Context>, loadDataAtBeginning: boolean) {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  Store.dispatch(setZoomStepAction(4));
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  const paintCenter = [0, 0, 0] as Vector3;
  // This particular brushSize used to trigger a bug. It should not be changed.
  const brushSize = 263;

  if (loadDataAtBeginning) {
    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      t.is(
        await t.context.api.data.getDataValue(volumeTracingLayerName, [0, 0, 0], zoomStep),
        oldCellId,
        `Center should have old value at zoomstep=${zoomStep}`,
      );
    }
  }

  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.ERASE_BRUSH));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());
  await t.context.api.tracing.save();
  const data = await t.context.api.data.getDataForBoundingBox(volumeTracingLayerName, {
    min: [0, 0, 0],
    max: [35, 1, 1],
  });

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    const readValue = await t.context.api.data.getDataValue(
      volumeTracingLayerName,
      [32, 0, 0],
      zoomStep,
    );
    t.is(readValue, 0, `Voxel should be erased at zoomstep=${zoomStep}`);
  }

  // @ts-ignore
  t.is(_.max(data), 0, "All the data should be 0 (== erased).");
}

test.serial("Undo erasing in mag 4 (load before undo)", undoEraseInMag4Helper, false);
test.serial("Undo erasing in mag 4 (load after undo)", undoEraseInMag4Helper, true);

async function undoEraseInMag4Helper(t: ExecutionContext<Context>, loadBeforeUndo: boolean) {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  Store.dispatch(setZoomStepAction(4));
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 10;
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.ERASE_BRUSH));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  if (loadBeforeUndo) {
    for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
      const readValue = await t.context.api.data.getDataValue(
        volumeTracingLayerName,
        [0, 0, 0],
        zoomStep,
      );
      t.is(readValue, 0, `Voxel should be erased at zoomstep=${zoomStep}`);
    }
  }

  await dispatchUndoAsync(Store.dispatch);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    const readValue = await t.context.api.data.getDataValue(
      volumeTracingLayerName,
      [0, 0, 0],
      zoomStep,
    );
    t.is(readValue, oldCellId, `After undo, voxel should have old value at zoomstep=${zoomStep}`);
  }
}

test.serial("Provoke race condition when bucket compression is very slow", async (t) => {
  t.context.setSlowCompression(true);
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  Store.dispatch(setZoomStepAction(4));
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  const paintCenter = [0, 0, 0] as Vector3;
  const brushSize = 10;
  Store.dispatch(setContourTracingModeAction(ContourModeEnum.DELETE));
  Store.dispatch(updateUserSettingAction("overwriteMode", OverwriteModeEnum.OVERWRITE_ALL));
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction(AnnotationToolEnum.ERASE_BRUSH));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    const readValue = await t.context.api.data.getDataValue(
      volumeTracingLayerName,
      [0, 0, 0],
      zoomStep,
    );
    t.is(readValue, 0, `Voxel should be erased at zoomstep=${zoomStep}`);
  }

  await dispatchUndoAsync(Store.dispatch);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    const readValue = await t.context.api.data.getDataValue(
      volumeTracingLayerName,
      [0, 0, 0],
      zoomStep,
    );
    t.is(readValue, oldCellId, `After undo, voxel should have old value at zoomstep=${zoomStep}`);
  }

  await dispatchRedoAsync(Store.dispatch);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    const readValue = await t.context.api.data.getDataValue(
      volumeTracingLayerName,
      [0, 0, 0],
      zoomStep,
    );
    t.is(readValue, 0, `Voxel should be erased at zoomstep=${zoomStep}`);
  }
});

test.serial("Undo for deleting segment group (without recursion)", async (t) => {
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
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
  const tracing = state.tracing.volumes[0];
  t.is(tracing.segmentGroups.length, 0);
  t.is(tracing.segments.size(), 4);

  for (const segment of tracing.segments.values()) {
    t.is(segment.groupId, null);
  }

  await dispatchUndoAsync(Store.dispatch);

  const stateRestored = Store.getState();
  const tracingRestored = stateRestored.tracing.volumes[0];
  t.is(tracingRestored.segmentGroups.length, 2);
  t.is(tracingRestored.segments.size(), 4);

  t.is(tracingRestored.segments.getOrThrow(1).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(2).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(3).groupId, 2);
  t.is(tracingRestored.segments.getOrThrow(4).groupId, 2);
});

test.serial("Undo for deleting segment group (with recursion)", async (t) => {
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
  const position = [1, 2, 3] as Vector3;
  Store.dispatch(clickSegmentAction(1, position, undefined));
  Store.dispatch(clickSegmentAction(2, position, undefined));
  Store.dispatch(clickSegmentAction(3, position, undefined));
  Store.dispatch(clickSegmentAction(4, position, undefined));

  Store.dispatch(
    setSegmentGroupsAction(
      [{ name: "Group 1", groupId: 1, children: [{ name: "Group 2", groupId: 2, children: [] }] }],
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
  const tracing = state.tracing.volumes[0];
  t.is(tracing.segmentGroups.length, 0);
  t.is(tracing.segments.size(), 0);

  await dispatchUndoAsync(Store.dispatch);

  const stateRestored = Store.getState();
  const tracingRestored = stateRestored.tracing.volumes[0];
  t.is(tracingRestored.segmentGroups.length, 1);
  t.is(tracingRestored.segmentGroups[0]?.children.length || 0, 1);
  t.is(tracingRestored.segments.size(), 4);

  t.is(tracingRestored.segments.getOrThrow(1).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(2).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(3).groupId, 2);
  t.is(tracingRestored.segments.getOrThrow(4).groupId, 2);
});

test.serial("Undo for deleting segment group (bug repro)", async (t) => {
  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerIds()[0];
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

  t.is(Store.getState().tracing.volumes[0].segmentGroups.length, 2);

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
  const tracing = state.tracing.volumes[0];
  t.is(tracing.segmentGroups.length, 0);
  t.is(tracing.segments.size(), 0);

  // Undo again
  await dispatchUndoAsync(Store.dispatch);

  t.is(Store.getState().tracing.volumes[0].segmentGroups.length, 2);

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
  const tracingRestored = stateRestored.tracing.volumes[0];
  t.is(tracingRestored.segments.size(), 4);
  t.is(tracingRestored.segmentGroups.length, 2);

  t.is(tracingRestored.segments.getOrThrow(1).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(2).groupId, 1);
  t.is(tracingRestored.segments.getOrThrow(3).groupId, 2);
  t.is(tracingRestored.segments.getOrThrow(4).groupId, 2);
});

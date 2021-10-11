// @flow
/* eslint-disable no-await-in-loop */

import mockRequire from "mock-require";
import test from "ava";
import { waitForCondition } from "libs/utils";
import _ from "lodash";

import "test/sagas/saga_integration.mock";
import {
  __setupOxalis,
  createBucketResponseFunction,
  getVolumeTracingOrFail,
} from "test/helpers/apiHelpers";
import { OrthoViews, FillModeEnum } from "oxalis/constants";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";

const { setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");
const { setPositionAction, setZoomStepAction } = mockRequire.reRequire(
  "oxalis/model/actions/flycam_actions",
);

const {
  setActiveCellAction,
  addToLayerAction,
  dispatchFloodfillAsync,
  copySegmentationLayerAction,
  startEditingAction,
  finishEditingAction,
} = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");
const { dispatchUndoAsync, dispatchRedoAsync, discardSaveQueuesAction } = mockRequire.reRequire(
  "oxalis/model/actions/save_actions",
);

test.beforeEach(async t => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());

  await __setupOxalis(t, "volume");

  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.serial("Executing a floodfill in mag 1", async t => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [0, 0, 43];
  const brushSize = 10;

  const newCellId = 2;

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 43]));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(await t.context.api.data.getDataValue("segmentation", paintCenter, zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 1, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 1, 43], zoomStep), newCellId);
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(await t.context.api.data.getDataValue("segmentation", [4, 0, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 4, 43], zoomStep), newCellId);
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(await t.context.api.data.getDataValue("segmentation", [3, 3, 43], zoomStep), newCellId);
  }
  await t.context.api.tracing.save();

  const floodingCellId = 3;

  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));

  await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue("segmentation", paintCenter, zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [1, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 1, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [1, 1, 43], zoomStep),
      floodingCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue("segmentation", [4, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 4, 43], zoomStep),
      floodingCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue("segmentation", [3, 3, 43], zoomStep),
      floodingCellId,
    );

    t.snapshot(
      await t.context.api.data.getDataFor2DBoundingBox("segmentation", {
        min: [32, 32, 32],
        max: [64, 64, 64],
      }),
      { id: `floodfill_mag1_${zoomStep}` },
    );
  }
});

test.serial("Executing a floodfill in mag 2", async t => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [0, 0, 43];
  const brushSize = 10;
  const newCellId = 2;

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 43]));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(await t.context.api.data.getDataValue("segmentation", paintCenter, zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 1, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 1, 43], zoomStep), newCellId);
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(await t.context.api.data.getDataValue("segmentation", [4, 0, 43], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 4, 43], zoomStep), newCellId);
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(await t.context.api.data.getDataValue("segmentation", [3, 3, 43], zoomStep), newCellId);
  }
  await t.context.api.tracing.save();

  const floodingCellId = 3;

  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(setZoomStepAction(2));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));
  await dispatchFloodfillAsync(Store.dispatch, [0, 0, 43], OrthoViews.PLANE_XY);

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(
      await t.context.api.data.getDataValue("segmentation", paintCenter, zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [1, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 1, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [1, 1, 43], zoomStep),
      floodingCellId,
    );
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(
      await t.context.api.data.getDataValue("segmentation", [4, 0, 43], zoomStep),
      floodingCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 4, 43], zoomStep),
      floodingCellId,
    );
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(
      await t.context.api.data.getDataValue("segmentation", [3, 3, 43], zoomStep),
      floodingCellId,
    );
  }
});

test.serial("Executing a floodfill in mag 1 (long operation)", async t => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [128, 128, 128];
  Store.dispatch(setPositionAction(paintCenter));

  const volumeTracingLayerName = t.context.api.data.getVolumeTracingLayerName();
  t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0), 0);

  const floodingCellId = 3;

  Store.dispatch(setActiveCellAction(floodingCellId));
  Store.dispatch(updateUserSettingAction("fillMode", FillModeEnum._3D));

  await dispatchFloodfillAsync(Store.dispatch, paintCenter, OrthoViews.PLANE_XY);

  async function assertFloodFilledState() {
    t.is(
      await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0),
      floodingCellId,
    );
    t.false(hasRootSagaCrashed());

    const cuboidData = await t.context.api.data.getDataFor2DBoundingBox(volumeTracingLayerName, {
      min: [128 - 64, 128 - 64, 128 - 32],
      max: [128 + 64, 128 + 64, 128 + 32],
    });
    // There should be no item which does not equal floodingCellId
    t.is(cuboidData.findIndex(el => el !== floodingCellId), -1);
  }

  async function assertInitialState() {
    t.is(await t.context.api.data.getDataValue(volumeTracingLayerName, paintCenter, 0), 0);

    t.false(hasRootSagaCrashed());

    const cuboidData = await t.context.api.data.getDataFor2DBoundingBox(volumeTracingLayerName, {
      min: [0, 0, 0],
      max: [256, 256, 256],
    });
    // There should be no non-zero item
    t.is(cuboidData.findIndex(el => el !== 0), -1);
  }

  // Assert state after flood-fill
  await assertFloodFilledState();

  // Undo and assert initial state
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

test.serial(
  "Executing copySegmentationLayer with a new segment id should update the maxCellId",
  t => {
    const newCellId = 13371338;
    Store.dispatch(setActiveCellAction(newCellId));
    Store.dispatch(copySegmentationLayerAction());

    // maxCellId should be updated after copySegmentationLayer
    getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
      t.is(tracing.maxCellId, newCellId);
    });
  },
);

test.serial("Brushing/Tracing with a new segment id should update the bucket data", async t => {
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
    0,
  );

  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [0, 0, 0];
  const brushSize = 10;

  const newCellId = 2;

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  for (let zoomStep = 0; zoomStep <= 5; zoomStep++) {
    t.is(await t.context.api.data.getDataValue("segmentation", paintCenter, zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 1, 0], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [1, 1, 0], zoomStep), newCellId);
    // A brush size of 10 means a radius of 5 (so, from 0 to 4).
    t.is(await t.context.api.data.getDataValue("segmentation", [4, 0, 0], zoomStep), newCellId);
    t.is(await t.context.api.data.getDataValue("segmentation", [0, 4, 0], zoomStep), newCellId);
    // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
    // (and not at 4,4)
    t.is(await t.context.api.data.getDataValue("segmentation", [3, 3, 0], zoomStep), newCellId);

    // In mag 1 and mag 2,
    t.is(
      await t.context.api.data.getDataValue("segmentation", [5, 0, 0], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 5, 0], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
    t.is(
      await t.context.api.data.getDataValue("segmentation", [0, 0, 1], zoomStep),
      zoomStep === 0 ? 0 : newCellId,
    );
  }

  t.snapshot(
    await t.context.api.data.getDataFor2DBoundingBox("segmentation", {
      min: [0, 0, 0],
      max: [32, 32, 32],
    }),
    { id: "volumetracing_brush_without_fallback_data" },
  );
});

test.serial("Brushing/Tracing with already existing backend data", async t => {
  const paintCenter = [0, 0, 0];
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

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), oldCellId);

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [0, 1, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 1, 0]), newCellId);
  // A brush size of 10 means a radius of 5 (so, from 0 to 4).
  t.is(await t.context.api.data.getDataValue("segmentation", [4, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [0, 4, 0]), newCellId);
  // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
  // (and not at 4,4)
  t.is(await t.context.api.data.getDataValue("segmentation", [3, 3, 0]), newCellId);

  t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), oldCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [0, 5, 0]), oldCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [0, 0, 1]), oldCellId);

  t.snapshot(
    await t.context.api.data.getDataFor2DBoundingBox("segmentation", {
      min: [0, 0, 0],
      max: [32, 32, 32],
    }),
    { id: "volumetracing_brush_with_fallback_data" },
  );
});

test.serial("Brushing/Tracing with undo (I)", async t => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [0, 0, 0];
  const brushSize = 10;

  const newCellId = 2;

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction("BRUSH"));

  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  Store.dispatch(setActiveCellAction(newCellId + 1));
  Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
  Store.dispatch(addToLayerAction(paintCenter));
  Store.dispatch(finishEditingAction());

  await dispatchUndoAsync(Store.dispatch);

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), oldCellId);
});

test.serial("Brushing/Tracing with undo (II)", async t => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  const paintCenter = [0, 0, 0];
  const brushSize = 10;

  const newCellId = 2;

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setPositionAction([0, 0, 0]));
  Store.dispatch(setToolAction("BRUSH"));

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

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId + 1);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId + 1);
  t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), oldCellId);
});

test.serial(
  "Brushing/Tracing should crash when too many buckets are labeled at once without saving inbetween",
  async t => {
    await t.context.api.tracing.save();

    t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
      Uint16Array,
      0,
      0,
    );
    // webKnossos will start to evict buckets forcefully if too many are dirty at the same time.
    // This is not ideal, but usually handled by the fact that buckets are regularly saved to the
    // backend and then marked as not dirty.
    // This test provokes that webKnossos crashes (a hard crash is only done during testing; in dev/prod
    // a soft warning is emitted via the devtools).
    // The corresponding sibling test checks that saving inbetween does not make webKnossos crash.
    t.plan(2);
    t.false(hasRootSagaCrashed());
    const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
    await Promise.race([testLabelingManyBuckets(t, false), failedSagaPromise]);
    t.true(hasRootSagaCrashed());
  },
);

test.serial(
  "Brushing/Tracing should send buckets to backend and restore dirty flag afterwards",
  async t => {
    await t.context.api.tracing.save();

    t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
      Uint16Array,
      0,
      0,
    );
    t.plan(2);
    t.false(hasRootSagaCrashed());
    const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
    await Promise.race([testLabelingManyBuckets(t, true), failedSagaPromise]);
    t.false(hasRootSagaCrashed());
  },
);

async function testLabelingManyBuckets(t, saveInbetween) {
  // We set MAXIMUM_BUCKET_COUNT to 150 and then label 199 = 75 (mag1) + 124 (downsampled) buckets in total.
  // In between, we will save the data which allows the buckets of the first batch to be GC'ed.
  // Therefore, saving the buckets of the second batch should not cause any problems.
  t.context.model.getCubeByLayerName("segmentation").MAXIMUM_BUCKET_COUNT = 150;

  const oldCellId = 11;
  const brushSize = 10;
  const newCellId = 2;

  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    oldCellId,
    500,
  );
  // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
  // function.
  await t.context.api.data.reloadAllBuckets();

  // Prepare to paint into the center of 50 buckets.
  const paintPositions1 = _.range(0, 50).map(idx => [32 * idx + 16, 32 * idx + 16, 32 * idx + 16]);
  // Prepare to paint into the center of 50 other buckets.
  const paintPositions2 = _.range(50, 100).map(idx => [
    32 * idx + 16,
    32 * idx + 16,
    32 * idx + 16,
  ]);

  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));

  for (const paintPosition of paintPositions1) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  if (saveInbetween) {
    await t.context.api.tracing.save();
  }

  for (const paintPosition of paintPositions2) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  await t.context.api.tracing.save();
}

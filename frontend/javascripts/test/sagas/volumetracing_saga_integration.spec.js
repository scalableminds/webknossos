// @flow
import mockRequire from "mock-require";
import test from "ava";
import { sleep } from "libs/utils";
import _ from "lodash";

import "test/sagas/saga_integration.mock.js";
import { __setupOxalis, getVolumeTracingOrFail } from "test/helpers/apiHelpers";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { OrthoViews } from "oxalis/constants";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
// import { getVolumeTracingOrFail } from "../reducers/volumetracing_reducer.spec";
const { setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");
const { setPositionAction } = mockRequire.reRequire("oxalis/model/actions/flycam_actions");
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import constants from "oxalis/constants";

const {
  setActiveCellAction,
  addToLayerAction,
  floodFillAction,
  copySegmentationLayerAction,
  startEditingAction,
  finishEditingAction,
} = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");
const { undoAction, discardSaveQueuesAction } = mockRequire.reRequire(
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

function createBucketResponseFunction(fillValue, delay) {
  return async function getBucketData(url, payload) {
    const bucketCount = payload.data.length;
    await sleep(delay);
    return {
      buffer: new Uint8Array(new Uint16Array(bucketCount * 32 ** 3).fill(fillValue).buffer),
      headers: { "missing-buckets": "[]" },
    };
  };
}

// test.serial("Executing a floodfill with a new segment id should update the maxCellId", t => {
//   const volumeTracing = enforceVolumeTracing(Store.getState().tracing);
//   const oldMaxCellId = volumeTracing.maxCellId;

//   const newCellId = 13371337;
//   Store.dispatch(setActiveCellAction(newCellId));

//   // maxCellId should not have changed since no voxel was annotated yet
//   getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
//     t.is(tracing.maxCellId, oldMaxCellId);
//   });

//   Store.dispatch(floodFillAction([12, 12, 12], OrthoViews.PLANE_XY));

//   // maxCellId should be updated after flood fill
//   getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
//     t.is(tracing.maxCellId, newCellId);
//   });
// });

// test.serial(
//   "Executing copySegmentationLayer with a new segment id should update the maxCellId",
//   t => {
//     const newCellId = 13371338;
//     Store.dispatch(setActiveCellAction(newCellId));
//     Store.dispatch(copySegmentationLayerAction());

//     // maxCellId should be updated after copySegmentationLayer
//     getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
//       t.is(tracing.maxCellId, newCellId);
//     });
//   },
// );

// test.serial("Brushing/Tracing with a new segment id should update the maxCellId", async t => {
//   t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders.returns(
//     Promise.resolve({ buffer: new Uint16Array(32 ** 3), headers: { "missing-buckets": "[]" } }),
//   );

//   const paintCenter = [0, 0, 0];
//   const oldDataValue = await t.context.api.data.getDataValue("segmentation", paintCenter);
//   const brushSize = 10;
//   console.log("oldDataValue", oldDataValue);

//   const newCellId = 2;

//   Store.dispatch(updateUserSettingAction("brushSize", brushSize));
//   Store.dispatch(setPositionAction([0, 0, 0]));
//   Store.dispatch(setToolAction("BRUSH"));
//   Store.dispatch(setActiveCellAction(newCellId));
//   Store.dispatch(startEditingAction(paintCenter, OrthoViews.PLANE_XY));
//   Store.dispatch(addToLayerAction(paintCenter));
//   Store.dispatch(finishEditingAction());

//   // maxCellId should be updated after brushing/tracing
//   // getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
//   //   t.is(tracing.maxCellId, newCellId);
//   // });

//   t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId);
//   t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId);
//   t.is(await t.context.api.data.getDataValue("segmentation", [0, 1, 0]), newCellId);
//   t.is(await t.context.api.data.getDataValue("segmentation", [1, 1, 0]), newCellId);
//   // A brush size of 10 means a radius of 5 (so, from 0 to 4).
//   t.is(await t.context.api.data.getDataValue("segmentation", [4, 0, 0]), newCellId);
//   t.is(await t.context.api.data.getDataValue("segmentation", [0, 4, 0]), newCellId);
//   // Since the brush is circle-like, the right-bottom point is only brushed at 3,3
//   // (and not at 4,4)
//   t.is(await t.context.api.data.getDataValue("segmentation", [3, 3, 0]), newCellId);

//   t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), 0);
//   t.is(await t.context.api.data.getDataValue("segmentation", [0, 5, 0]), 0);
//   t.is(await t.context.api.data.getDataValue("segmentation", [0, 0, 1]), 0);
// });

test.serial("Brushing/Tracing with already existing backend data", async t => {
  const paintCenter = [0, 0, 0];
  const brushSize = 10;
  const newCellId = 2;
  const oldCellId = 11;

  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    oldCellId,
    0,
  );

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
});

test.serial("Brushing/Tracing with undo (I)", async t => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    oldCellId,
    500,
  );

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

  await sleep(2000);

  Store.dispatch(undoAction());

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId);
  t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), oldCellId);
});

test.serial("Brushing/Tracing with undo (II)", async t => {
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    oldCellId,
    500,
  );

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

  await sleep(2000);

  Store.dispatch(undoAction());

  t.is(await t.context.api.data.getDataValue("segmentation", paintCenter), newCellId + 1);
  t.is(await t.context.api.data.getDataValue("segmentation", [1, 0, 0]), newCellId + 1);
  t.is(await t.context.api.data.getDataValue("segmentation", [5, 0, 0]), oldCellId);
});

test.only("Brushing/Tracing should send buckets to backend and restore dirty flag", async t => {
  const originalValue = constants.MAXIMUM_BUCKET_COUNT_PER_LAYER;
  constants.MAXIMUM_BUCKET_COUNT_PER_LAYER = 75;

  debugger;
  const oldCellId = 11;
  t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    oldCellId,
    500,
  );

  const paintPositions1 = _.range(0, 50).map(idx => [32 * idx + 16, 32 * idx + 16, 32 * idx + 16]);
  console.log("paintPositions1", paintPositions1);
  const paintPositions2 = _.range(50, 100).map(idx => [
    32 * idx + 16,
    32 * idx + 16,
    32 * idx + 16,
  ]);

  const brushSize = 10;

  const newCellId = 2;
  Store.dispatch(updateUserSettingAction("brushSize", brushSize));
  Store.dispatch(setToolAction("BRUSH"));
  Store.dispatch(setActiveCellAction(newCellId));

  for (const paintPosition of paintPositions1) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  await t.context.api.tracing.save();

  for (const paintPosition of paintPositions2) {
    Store.dispatch(setPositionAction(paintPosition));
    Store.dispatch(startEditingAction(paintPosition, OrthoViews.PLANE_XY));
    Store.dispatch(addToLayerAction(paintPosition));
    Store.dispatch(finishEditingAction());
  }

  await t.context.api.tracing.save();
  constants.MAXIMUM_BUCKET_COUNT_PER_LAYER = originalValue;
});

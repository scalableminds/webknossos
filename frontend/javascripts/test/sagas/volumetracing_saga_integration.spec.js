// @flow
import mockRequire from "mock-require";
import test from "ava";

import "test/sagas/saga_integration.mock.js";
import { __setupOxalis } from "test/helpers/apiHelpers";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { OrthoViews } from "oxalis/constants";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import { getVolumeTracingOrFail } from "../reducers/volumetracing_reducer.spec";

const {
  setActiveCellAction,
  floodFillAction,
  copySegmentationLayerAction,
  startEditingAction,
  finishEditingAction,
} = mockRequire.reRequire("oxalis/model/actions/volumetracing_actions");
const { discardSaveQueuesAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");

test.beforeEach(async t => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  await __setupOxalis(t, "volume");

  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.serial("Executing a floodfill with a new segment id should update the maxCellId", t => {
  const volumeTracing = enforceVolumeTracing(Store.getState().tracing);
  const oldMaxCellId = volumeTracing.maxCellId;

  const newCellId = 13371337;
  Store.dispatch(setActiveCellAction(newCellId));

  // maxCellId should not have changed since no voxel was annotated yet
  getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
    t.is(tracing.maxCellId, oldMaxCellId);
  });

  Store.dispatch(floodFillAction([12, 12, 12], OrthoViews.PLANE_XY));

  // maxCellId should be updated after flood fill
  getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
    t.is(tracing.maxCellId, newCellId);
  });
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

test.serial("Brushing/Tracing with a new segment id should update the maxCellId", t => {
  const newCellId = 13371339;
  Store.dispatch(setActiveCellAction(newCellId));
  Store.dispatch(startEditingAction([12, 12, 12], OrthoViews.PLANE_XY));
  Store.dispatch(finishEditingAction());

  // maxCellId should be updated after brushing/tracing
  getVolumeTracingOrFail(Store.getState().tracing).map(tracing => {
    t.is(tracing.maxCellId, newCellId);
  });
});

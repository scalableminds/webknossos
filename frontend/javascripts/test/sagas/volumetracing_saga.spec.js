// @flow
import "test/sagas/volumetracing_saga.mock.js";

import { take, put, call } from "redux-saga/effects";
import _ from "lodash";
import update from "immutability-helper";

import { OrthoViews, VolumeToolEnum, ContourModeEnum } from "oxalis/constants";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import defaultState from "oxalis/default_state";
import mockRequire from "mock-require";
import test from "ava";

import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import { withoutUpdateTracing } from "../helpers/saveHelpers";

const mockedVolumeLayer = {
  isEmpty: () => false,
  finish: _.noop,
  getVoxelIterator: _.noop,
  getCentroid: _.noop,
};

mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
mockRequire("@tensorflow/tfjs", {});
mockRequire("oxalis/workers/tensorflow.impl", {});
mockRequire("oxalis/workers/tensorflow.worker", {});

const { saveTracingTypeAsync } = require("oxalis/model/sagas/save_saga");
const { editVolumeLayerAsync, finishLayer } = require("oxalis/model/sagas/volumetracing_saga");
const VolumeLayer = require("oxalis/model/volumetracing/volumelayer").default;

const volumeTracing = {
  type: "volume",
  annotationType: "Explorational",
  name: "",
  activeTool: VolumeToolEnum.TRACE,
  activeCellId: 0,
  cells: [],
  viewMode: 0,
  maxCellId: 0,
  contourList: [[1, 2, 3], [7, 8, 9]],
  restrictions: {
    branchPointsAllowed: true,
    allowUpdate: true,
    allowFinish: true,
    allowAccess: true,
    allowDownload: true,
  },
};

const initialState = update(defaultState, {
  tracing: {
    volume: { $set: volumeTracing },
  },
});

const ACTIVE_CELL_ID = 5;

const setActiveCellAction = VolumeTracingActions.setActiveCellAction(ACTIVE_CELL_ID);
const startEditingAction = VolumeTracingActions.startEditingAction([0, 0, 0], OrthoViews.PLANE_XY);
const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
const finishEditingAction = VolumeTracingActions.finishEditingAction();
const resetContourAction = VolumeTracingActions.resetContourAction();

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", t => {
  const saga = saveTracingTypeAsync("volume");
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_VOLUMETRACING"));
  saga.next();
  saga.next(initialState.tracing);
  saga.next(initialState.flycam);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(true);
  saga.next(initialState.tracing);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", t => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingTypeAsync("volume");
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_VOLUMETRACING"));
  saga.next();
  saga.next(initialState.tracing);
  saga.next(initialState.flycam);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(true);
  saga.next(newState.tracing);
  const items = execCall(t, saga.next(newState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
  t.true(items[0].value.activeSegmentId === ACTIVE_CELL_ID);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueTransaction(items, "volume")));
});

test("VolumeTracingSaga should create a volume layer (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DRAW_OVERWRITE);
  const startEditingSaga = execCall(t, saga.next(false));
  startEditingSaga.next();
  const layer = startEditingSaga.next([1, 1, 1]).value;
  t.is(layer.plane, OrthoViews.PLANE_XY);
});

test("VolumeTracingSaga should add values to volume layer (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DRAW_OVERWRITE);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next(VolumeToolEnum.TRACE);
  saga.next(OrthoViews.PLANE_XY);
  saga.next();
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  saga.next(OrthoViews.PLANE_XY);
  saga.next({ addToLayerAction: addToLayerActionFn([2, 3, 4]) });
  saga.next(OrthoViews.PLANE_XY);
  saga.next({ addToLayerAction: addToLayerActionFn([3, 4, 5]) });
  saga.next(OrthoViews.PLANE_XY);
  t.deepEqual(volumeLayer.minCoord, [-1, 0, 1]);
  t.deepEqual(volumeLayer.maxCoord, [5, 6, 7]);
});

test("VolumeTracingSaga should finish a volume layer (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DRAW_OVERWRITE);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next(VolumeToolEnum.TRACE);
  saga.next(OrthoViews.PLANE_XY);
  saga.next();
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  saga.next(OrthoViews.PLANE_XY);
  // Validate that finishLayer was called
  expectValueDeepEqual(
    t,
    saga.next({ finishEditingAction }),
    call(finishLayer, volumeLayer, VolumeToolEnum.TRACE, ContourModeEnum.DRAW_OVERWRITE),
  );
});

test("VolumeTracingSaga should finish a volume layer in delete mode (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DELETE_FROM_ACTIVE_CELL);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next(VolumeToolEnum.TRACE);
  saga.next(OrthoViews.PLANE_XY);
  saga.next();
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  saga.next(OrthoViews.PLANE_XY);
  // Validate that finishLayer was called
  expectValueDeepEqual(
    t,
    saga.next({ finishEditingAction }),
    call(finishLayer, volumeLayer, VolumeToolEnum.TRACE, ContourModeEnum.DELETE_FROM_ACTIVE_CELL),
  );
});

test("finishLayer saga should emit resetContourAction and then be done (saga test)", t => {
  // $FlowFixMe
  const saga = finishLayer(mockedVolumeLayer, VolumeToolEnum.TRACE);
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(), put(resetContourAction));
  t.true(saga.next().done);
});

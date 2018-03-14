/**
 * volumetracing_saga.spec.js
 * @flow
 */

/* eslint-disable import/no-extraneous-dependencies, import/first */
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import mockRequire from "mock-require";
import _ from "lodash";
import { OrthoViews, VolumeToolEnum, ContourModeEnum } from "oxalis/constants";
import update from "immutability-helper";
import { take, put, race, call } from "redux-saga/effects";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
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

const { saveTracingAsync } = require("oxalis/model/sagas/save_saga");
const { editVolumeLayerAsync, finishLayer } = require("oxalis/model/sagas/volumetracing_saga");
const VolumeLayer = require("oxalis/model/volumetracing/volumelayer").default;
const { defaultState } = require("oxalis/store");

const volumeTracing = {
  type: "volume",
  tracingType: "Explorational",
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
    $set: volumeTracing,
  },
});

const ACTIVE_CELL_ID = 5;

const setActiveCellAction = VolumeTracingActions.setActiveCellAction(ACTIVE_CELL_ID);
const startEditingAction = VolumeTracingActions.startEditingAction([0, 0, 0], OrthoViews.PLANE_XY);
const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
const finishEditingAction = VolumeTracingActions.finishEditingAction();
const resetContourAction = VolumeTracingActions.resetContourAction();

const INIT_RACE_ACTION_OBJECT = {
  initSkeleton: take("INITIALIZE_SKELETONTRACING"),
  initVolume: take("INITIALIZE_VOLUMETRACING"),
};

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", t => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(initialState.tracing);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", t => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(newState.tracing);
  const items = execCall(t, saga.next(newState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
  t.true(items[0].value.activeSegmentId === ACTIVE_CELL_ID);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueAction(items)));
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
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  saga.next({ addToLayerAction: addToLayerActionFn([2, 3, 4]) });
  saga.next({ addToLayerAction: addToLayerActionFn([3, 4, 5]) });
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
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
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
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
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
  const iterator = saga.next();
  expectValueDeepEqual(t, iterator, put(resetContourAction));
  t.true(saga.next().done);
});

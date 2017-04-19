/**
 * volumetracing_saga.spec.js
 * @flow
 */

/* eslint-disable import/no-extraneous-dependencies, import/first */
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import mockRequire from "mock-require";
import _ from "lodash";
import { OrthoViews } from "oxalis/constants";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import update from "immutability-helper";
import { take, put, race, call } from "redux-saga/effects";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import { pushSaveQueueAction } from "oxalis/model/actions/save_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";

const mockedVolumeLayer = {
  isEmpty: () => false,
  finish: _.noop,
  getVoxelIterator: _.noop,
  getCentroid: _.noop,
};

mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });

const { saveTracingAsync } = require("oxalis/model/sagas/save_saga");
const { editVolumeLayerAsync, finishLayer } = require("oxalis/model/sagas/volumetracing_saga");
const VolumeLayer = require("oxalis/model/volumetracing/volumelayer").default;
const { defaultState } = require("oxalis/store");


function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter(item => item.action !== "updateTracing");
}

const volumeTracing = {
  type: "volume",
  tracingType: "Explorational",
  name: "",
  activeCellId: 0,
  cells: [],
  viewMode: 0,
  idCount: 1,
  contourList: [[1, 2, 3], [7, 8, 9]],
  restrictions: {
    branchPointsAllowed: true,
    allowUpdate: true,
    allowFinish: true,
    allowAccess: true,
    allowDownload: true,
  },
};

const initialState = update(defaultState, { tracing: {
  $set: volumeTracing,
} });

const ACTIVE_CELL_ID = 5;

const setActiveCellAction = VolumeTracingActions.setActiveCellAction(ACTIVE_CELL_ID);
const createCellAction = VolumeTracingActions.createCellAction();
const startEditingAction = VolumeTracingActions.startEditingAction(OrthoViews.PLANE_XY);
const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
const finishEditingAction = VolumeTracingActions.finishEditingAction();
const resetContourAction = VolumeTracingActions.resetContourAction();

const INIT_RACE_ACTION_OBJECT = {
  initSkeleton: take("INITIALIZE_SKELETONTRACING"),
  initVolume: take("INITIALIZE_VOLUMETRACING"),
};

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", (t) => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next();
  saga.next(initialState.tracing);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", (t) => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initVolume: true });
  saga.next(initialState.tracing);
  saga.next();
  saga.next();
  saga.next(newState.tracing);
  const items = execCall(t, saga.next(newState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
  t.true(items[0].value.activeCell === ACTIVE_CELL_ID);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueAction(items)));
});

test("VolumeTracingSaga should create a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  const startEditingSaga = execCall(t, saga.next(false));
  startEditingSaga.next();
  const layer = startEditingSaga.next([1, 1, 1]).value;
  t.is(layer.plane, OrthoViews.PLANE_XY);
});

test("VolumeTracingSaga should add values to volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  saga.next({ addToLayerAction: addToLayerActionFn([2, 3, 4]) });
  saga.next({ addToLayerAction: addToLayerActionFn([3, 4, 5]) });
  t.deepEqual(volumeLayer.minCoord, [-1, 0, 1]);
  t.deepEqual(volumeLayer.maxCoord, [5, 6, 7]);
});

test("VolumeTracingSaga should finish a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10);
  saga.next(volumeLayer);
  saga.next({ addToLayerAction: addToLayerActionFn([1, 2, 3]) });
  // Validate that finishLayer was called
  expectValueDeepEqual(t, saga.next({ finishEditingAction }), call(finishLayer, volumeLayer));
});

test("VolumeTracingSaga should abort editing on cell creation (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(false);
  saga.next();
  saga.next({ createCellAction });
  saga.next();
  // Saga should be at the beginning again
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
});

test("finishLayer saga should emit resetContourAction and then be done (saga test)", (t) => {
  // $FlowFixMe
  const saga = finishLayer(mockedVolumeLayer);
  saga.next();
  saga.next(ACTIVE_CELL_ID);
  const iterator = saga.next();
  expectValueDeepEqual(t, iterator, put(resetContourAction));
  t.true(saga.next().done);
});

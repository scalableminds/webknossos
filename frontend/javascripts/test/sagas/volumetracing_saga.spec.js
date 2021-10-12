// @flow
import "test/sagas/volumetracing_saga.mock.js";

import { take, put, call } from "redux-saga/effects";
import update from "immutability-helper";

import {
  OrthoViews,
  AnnotationToolEnum,
  ContourModeEnum,
  OverwriteModeEnum,
} from "oxalis/constants";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import defaultState from "oxalis/default_state";
import mockRequire from "mock-require";
import test from "ava";
import type { VolumeTracing } from "oxalis/store";

import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import { withoutUpdateTracing } from "../helpers/saveHelpers";

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

const volumeTracing: VolumeTracing = {
  type: "volume",
  createdTimestamp: 0,
  tracingId: "tracingId",
  version: 0,
  segments: new Map(),
  activeCellId: 0,
  cells: {},
  maxCellId: 0,
  contourList: [[1, 2, 3], [7, 8, 9]],
  boundingBox: null,
  userBoundingBoxes: [],
  lastCentroid: null,
  contourTracingMode: ContourModeEnum.DRAW,
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

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", t => {
  const saga = saveTracingTypeAsync("volume");
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_VOLUMETRACING"));
  saga.next();
  saga.next(initialState.tracing);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(true);
  saga.next(initialState.tracing);
  saga.next(initialState.flycam);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.viewModeData.plane.tdCamera));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", t => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingTypeAsync("volume");
  expectValueDeepEqual(t, saga.next(), take("INITIALIZE_VOLUMETRACING"));
  saga.next();
  saga.next(initialState.tracing);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(true);
  saga.next(newState.tracing);
  saga.next(newState.flycam);
  const items = execCall(t, saga.next(newState.viewModeData.plane.tdCamera));
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
  saga.next(ContourModeEnum.DRAW);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.BRUSH);
  saga.next(false);
  // pass labeled resolution
  const startEditingSaga = execCall(t, saga.next({ resolution: [1, 1, 1], zoomStep: 0 }));
  startEditingSaga.next();
  // Pass position
  const layer = startEditingSaga.next([1, 1, 1]).value;
  t.is(layer.plane, OrthoViews.PLANE_XY);
});

test("VolumeTracingSaga should add values to volume layer (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DRAW);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10, [1, 1, 1]);
  saga.next(volumeLayer);
  saga.next(OrthoViews.PLANE_XY);
  saga.next("action_channel");
  saga.next(addToLayerActionFn([1, 2, 3]));
  saga.next(OrthoViews.PLANE_XY);
  saga.next(addToLayerActionFn([2, 3, 4]));
  saga.next(OrthoViews.PLANE_XY);
  saga.next(addToLayerActionFn([3, 4, 5]));
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
  saga.next(ContourModeEnum.DRAW);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10, [1, 1, 1]);
  saga.next(volumeLayer);
  saga.next(OrthoViews.PLANE_XY);
  saga.next("action_channel");
  saga.next(addToLayerActionFn([1, 2, 3]));
  saga.next(OrthoViews.PLANE_XY);
  // Validate that finishLayer was called
  expectValueDeepEqual(
    t,
    saga.next(finishEditingAction),
    call(
      finishLayer,
      volumeLayer,
      AnnotationToolEnum.TRACE,
      ContourModeEnum.DRAW,
      OverwriteModeEnum.OVERWRITE_ALL,
      0,
    ),
  );
});

test("VolumeTracingSaga should finish a volume layer in delete mode (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(ContourModeEnum.DELETE);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  const volumeLayer = new VolumeLayer(OrthoViews.PLANE_XY, 10, [1, 1, 1]);
  saga.next(volumeLayer);
  saga.next(OrthoViews.PLANE_XY);
  saga.next("action_channel");
  saga.next(addToLayerActionFn([1, 2, 3]));
  saga.next(OrthoViews.PLANE_XY);
  // Validate that finishLayer was called
  expectValueDeepEqual(
    t,
    saga.next(finishEditingAction),
    call(
      finishLayer,
      volumeLayer,
      AnnotationToolEnum.TRACE,
      ContourModeEnum.DELETE,
      OverwriteModeEnum.OVERWRITE_ALL,
      0,
    ),
  );
});

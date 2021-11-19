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
import type { ServerVolumeTracing } from "types/api_flow_types";
import type { VolumeTracing } from "oxalis/store";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import DiffableMap from "libs/diffable_map";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import defaultState from "oxalis/default_state";
import mockRequire from "mock-require";
import sinon from "sinon";
import test from "ava";

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
  segments: new DiffableMap(),
  activeCellId: 0,
  maxCellId: 0,
  contourList: [[1, 2, 3], [7, 8, 9]],
  boundingBox: null,
  userBoundingBoxes: [],
  lastCentroid: null,
  contourTracingMode: ContourModeEnum.DRAW,
};

// todo: use VolumeTracingReducer here? would need refactoring
const serverVolumeTracing: ServerVolumeTracing = {
  typ: "Volume",
  id: "tracingId",
  elementClass: "uint32",
  createdTimestamp: 0,
  version: 0,
  boundingBox: { topLeft: { x: 0, y: 0, z: 0 }, width: 10, height: 10, depth: 10 },
  zoomLevel: 0,
  segments: [],
  editPosition: { x: 0, y: 0, z: 0 },
  editRotation: { x: 0, y: 0, z: 0 },
  userBoundingBoxes: [],
  dataSetName: "dataset_name",
  largestSegmentId: 0,
};

const initialState = update(defaultState, {
  tracing: {
    volumes: { $set: [volumeTracing] },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [
          {
            category: "segmentation",
            // +largestSegmentId: number,
            // +originalElementClass?: ElementClass,
            // +mappings?: Array<string>,
            // +agglomerates?: Array<string>,
            // +fallbackLayer?: ?string,
            // // eslint-disable-next-line no-use-before-define
            // +fallbackLayerInfo?: APIDataLayer,
            name: volumeTracing.tracingId,
            tracingId: volumeTracing.tracingId,
          },
        ],
      },
    },
  },
  datasetConfiguration: {
    layers: {
      $set: {
        [volumeTracing.tracingId]: {
          isDisabled: false,
          alpha: 100,
        },
      },
    },
  },
});

const ACTIVE_CELL_ID = 5;

const setActiveCellAction = VolumeTracingActions.setActiveCellAction(ACTIVE_CELL_ID);
const startEditingAction = VolumeTracingActions.startEditingAction([0, 0, 0], OrthoViews.PLANE_XY);
const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
const finishEditingAction = VolumeTracingActions.finishEditingAction();

const TIMESTAMP = 123456789;
test.before("Mock Date.now", async () => {
  // This only mocks Date.now, but leaves the constructor intact
  sinon.stub(Date, "now").returns(TIMESTAMP);
});

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", t => {
  const saga = saveTracingTypeAsync(
    VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
  );
  saga.next(); // forking pushTracingTypeAsync
  saga.next();
  saga.next(initialState.tracing.volumes[0]);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next();
  saga.next(true);
  saga.next(initialState.tracing.volumes[0]);
  saga.next(initialState.flycam);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.viewModeData.plane.tdCamera));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("VolumeTracingSaga should do something if changed (saga test)", t => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);

  const saga = saveTracingTypeAsync(
    VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
  );
  saga.next(); // forking pushTracingTypeAsync
  saga.next();
  saga.next(initialState.tracing.volumes[0]);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next();
  saga.next(true);
  saga.next(newState.tracing.volumes[0]);
  saga.next(newState.flycam);
  const items = execCall(t, saga.next(newState.viewModeData.plane.tdCamera));
  t.is(withoutUpdateTracing(items).length, 0);
  t.true(items[0].value.activeSegmentId === ACTIVE_CELL_ID);
  expectValueDeepEqual(
    t,
    saga.next(items),
    put(pushSaveQueueTransaction(items, "volume", volumeTracing.tracingId)),
  );
});

test("VolumeTracingSaga should create a volume layer (saga test)", t => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.BRUSH);
  saga.next(false);
  // pass labeled resolution
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 });
  expectValueDeepEqual(
    t,
    saga.next(ACTIVE_CELL_ID), // pass active cell id
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
        },
        volumeTracing.tracingId,
      ),
    ),
  );

  const startEditingSaga = execCall(t, saga.next());
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
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  expectValueDeepEqual(
    t,
    saga.next(ACTIVE_CELL_ID), // pass active cell id
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action
  const volumeLayer = new VolumeLayer(volumeTracing, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
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
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  expectValueDeepEqual(
    t,
    saga.next(ACTIVE_CELL_ID), // pass active cell id
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action
  const volumeLayer = new VolumeLayer(volumeTracing, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
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
  saga.next({ ...volumeTracing, contourTracingMode: ContourModeEnum.DELETE });
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({ resolution: [1, 1, 1], zoomStep: 0 }); // pass labeled resolution
  expectValueDeepEqual(
    t,
    saga.next(ACTIVE_CELL_ID), // pass active cell id
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action
  const volumeLayer = new VolumeLayer(volumeTracing, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
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

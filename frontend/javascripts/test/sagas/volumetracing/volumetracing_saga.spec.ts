import "test/sagas/volumetracing/volumetracing_saga.mock";
import { take, put, call } from "redux-saga/effects";
import update from "immutability-helper";
import _ from "lodash";
import type { APISegmentationLayer, ServerVolumeTracing } from "types/api_flow_types";
import {
  OrthoViews,
  AnnotationToolEnum,
  ContourModeEnum,
  OverwriteModeEnum,
  MappingStatusEnum,
} from "oxalis/constants";
import { convertFrontendBoundingBoxToServer } from "oxalis/model/reducers/reducer_helpers";
import { enforce } from "libs/utils";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import defaultState from "oxalis/default_state";
import mockRequire from "mock-require";
import sinon from "sinon";
import test from "ava";
import { expectValueDeepEqual, execCall } from "test/helpers/sagaHelpers";
import { withoutUpdateTracing } from "test/helpers/saveHelpers";
import type { ActiveMappingInfo } from "oxalis/store";
import { askUserForLockingActiveMapping } from "oxalis/model/sagas/saga_helpers";

mockRequire("app", {
  currentUser: {
    firstName: "SCM",
    lastName: "Boy",
  },
});
mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});
mockRequire("libs/toast", {
  info: _.noop,
});

const { setupSavingForTracingType } = require("oxalis/model/sagas/save_saga");

const { editVolumeLayerAsync, finishLayer } = require("oxalis/model/sagas/volumetracing_saga");
const {
  requestBucketModificationInVolumeTracing,
  ensureMaybeActiveMappingIsLocked,
} = require("oxalis/model/sagas/saga_helpers");

const VolumeLayer = require("oxalis/model/volumetracing/volumelayer").default;

const {
  serverVolumeToClientVolumeTracing,
} = require("oxalis/model/reducers/volumetracing_reducer");

const serverVolumeTracing: ServerVolumeTracing = {
  typ: "Volume",
  id: "tracingId",
  elementClass: "uint32",
  createdTimestamp: 0,
  boundingBox: {
    topLeft: {
      x: 0,
      y: 0,
      z: 0,
    },
    width: 10,
    height: 10,
    depth: 10,
  },
  zoomLevel: 0,
  segments: [],
  segmentGroups: [],
  editPosition: {
    x: 0,
    y: 0,
    z: 0,
  },
  editPositionAdditionalCoordinates: null,
  editRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
  additionalAxes: [],
  userBoundingBoxes: [],
  largestSegmentId: 0,
};
const volumeTracing = serverVolumeToClientVolumeTracing(serverVolumeTracing);
const volumeTracingLayer: APISegmentationLayer = {
  name: volumeTracing.tracingId,
  category: "segmentation",
  boundingBox: enforce(convertFrontendBoundingBoxToServer)(volumeTracing.boundingBox),
  resolutions: [[1, 1, 1]],
  elementClass: serverVolumeTracing.elementClass,
  largestSegmentId: serverVolumeTracing.largestSegmentId,
  tracingId: volumeTracing.tracingId,
  additionalAxes: [],
};
const initialState = update(defaultState, {
  tracing: {
    volumes: {
      $set: [volumeTracing],
    },
  },
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [volumeTracingLayer],
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

const dummyActiveMapping: ActiveMappingInfo = {
  mappingName: "dummy-mapping-name",
  mapping: new Map(),
  mappingColors: [],
  hideUnmappedIds: false,
  mappingStatus: "ENABLED",
  mappingType: "HDF5",
};

const ensureMaybeMappingIsLockedReturnValueDummy = { isMappingLockedIfNeeded: true };

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

test("VolumeTracingSaga shouldn't do anything if unchanged (saga test)", (t) => {
  const saga = setupSavingForTracingType(
    VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
  );

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

test("VolumeTracingSaga should do something if changed (saga test)", (t) => {
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);
  const saga = setupSavingForTracingType(
    VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
  );

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
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueTransaction(items)));
});

test("VolumeTracingSaga should create a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next({
    isBusy: false,
  });
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.BRUSH);
  saga.next(false);
  // pass labeled mag
  saga.next({
    mag: [1, 1, 1],
    zoomStep: 0,
  });
  saga.next(ACTIVE_CELL_ID); // pass active cell id
  saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
  expectValueDeepEqual(
    t,
    saga.next([]), // pass empty additional coords
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
          someAdditionalCoordinates: [],
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

test("VolumeTracingSaga should add values to volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next({
    isBusy: false,
  });
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({
    mag: [1, 1, 1],
    zoomStep: 0,
  }); // pass labeled mag

  saga.next(ACTIVE_CELL_ID); // pass active cell id
  saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
  expectValueDeepEqual(
    t,
    saga.next([]), // pass empty additional coords

    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
          someAdditionalCoordinates: [],
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action

  const volumeLayer = new VolumeLayer(volumeTracing.tracingId, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
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

test("VolumeTracingSaga should finish a volume layer (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next({
    isBusy: false,
  });
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({
    mag: [1, 1, 1],
    zoomStep: 0,
  }); // pass labeled mag

  saga.next(ACTIVE_CELL_ID); // pass active cell id
  saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
  expectValueDeepEqual(
    t,
    saga.next([]), // pass empty additional coords

    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
          someAdditionalCoordinates: [],
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action

  const volumeLayer = new VolumeLayer(volumeTracing.tracingId, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
  saga.next(volumeLayer);
  saga.next(OrthoViews.PLANE_XY);
  saga.next("action_channel");
  saga.next(addToLayerActionFn([1, 2, 3]));
  saga.next(OrthoViews.PLANE_XY);
  // Validate that finishLayer was called
  const wroteVoxelsBox = {
    value: false,
  };
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
      OrthoViews.PLANE_XY,
      wroteVoxelsBox,
    ),
  );
});

test("VolumeTracingSaga should finish a volume layer in delete mode (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next({
    isBusy: false,
  });
  saga.next({ ...volumeTracing, contourTracingMode: ContourModeEnum.DELETE });
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.TRACE);
  saga.next(false);
  saga.next({
    mag: [1, 1, 1],
    zoomStep: 0,
  }); // pass labeled mag
  saga.next(ACTIVE_CELL_ID); // pass active cell id
  saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
  expectValueDeepEqual(
    t,
    saga.next([]), // pass empty additional coords
    put(
      VolumeTracingActions.updateSegmentAction(
        ACTIVE_CELL_ID,
        {
          somePosition: startEditingAction.position,
          someAdditionalCoordinates: [],
        },
        volumeTracing.tracingId,
      ),
    ),
  );
  saga.next(); // advance from the put action

  const volumeLayer = new VolumeLayer(volumeTracing.tracingId, OrthoViews.PLANE_XY, 10, [1, 1, 1]);
  saga.next(volumeLayer);
  saga.next(OrthoViews.PLANE_XY);
  saga.next("action_channel");
  saga.next(addToLayerActionFn([1, 2, 3]));
  saga.next(OrthoViews.PLANE_XY);
  const wroteVoxelsBox = {
    value: false,
  };
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
      OrthoViews.PLANE_XY,
      wroteVoxelsBox,
    ),
  );
});

test("VolumeTracingSaga should ignore brush action when busy (saga test)", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  // When isBusy is true, the saga should wait for a new START_EDITING action
  // (thus, other actions, such as finishLayer, will be ignored).
  expectValueDeepEqual(
    t,
    saga.next({
      isBusy: true,
    }),
    take("START_EDITING"),
  );
});

test("VolumeTracingSaga should lock an active mapping upon first volume annotation", (t) => {
  const saga = editVolumeLayerAsync();
  saga.next();
  saga.next();
  expectValueDeepEqual(t, saga.next(true), take("START_EDITING"));
  saga.next(startEditingAction);
  saga.next({
    isBusy: false,
  });
  saga.next(volumeTracing);
  saga.next(OverwriteModeEnum.OVERWRITE_ALL);
  saga.next(AnnotationToolEnum.BRUSH);
  saga.next(false);
  // pass labeled mag
  saga.next({
    mag: [1, 1, 1],
    zoomStep: 0,
  });
  // Test whether nested saga requestBucketModificationInVolumeTracing is called.
  expectValueDeepEqual(
    t,
    saga.next(ACTIVE_CELL_ID),
    call(requestBucketModificationInVolumeTracing, volumeTracing),
  );
});

test("ensureMaybeActiveMappingIsLocked should lock an existing mapping to the annotation", (t) => {
  const activeMappingByLayer = { [volumeTracing.tracingId]: dummyActiveMapping };
  const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
  saga.next();
  expectValueDeepEqual(
    t,
    saga.next({ [volumeTracing.tracingId]: dummyActiveMapping }),
    call(askUserForLockingActiveMapping, volumeTracing, activeMappingByLayer),
  );
  t.true(saga.next().done);
});

test("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case no mapping is active.", (t) => {
  const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
  saga.next();
  expectValueDeepEqual(t, saga.next({}), put(VolumeTracingActions.setMappingIsLockedAction()));
  t.true(saga.next().done);
});

test("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case a mapping is active but disabled.", (t) => {
  const jsonDummyMapping = { ...dummyActiveMapping, mappingStatus: MappingStatusEnum.DISABLED };
  const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
  saga.next();
  expectValueDeepEqual(
    t,
    saga.next({ [volumeTracing.tracingId]: jsonDummyMapping }),
    put(VolumeTracingActions.setMappingIsLockedAction()),
  );
  t.true(saga.next().done);
});

test("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case a JSON mapping is active.", (t) => {
  const jsonDummyMapping = { ...dummyActiveMapping, mappingType: "JSON" };
  const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
  saga.next();
  expectValueDeepEqual(
    t,
    saga.next({ [volumeTracing.tracingId]: jsonDummyMapping }),
    put(VolumeTracingActions.setMappingIsLockedAction()),
  );
  t.true(saga.next().done);
});

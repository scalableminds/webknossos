import { vi, it, expect, describe } from "vitest";
import { take, put, call } from "redux-saga/effects";
import update from "immutability-helper";
import type { APISegmentationLayer, ServerVolumeTracing } from "types/api_types";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import {
  OrthoViews,
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
import { expectValueDeepEqual, execCall } from "test/helpers/sagaHelpers";
import { withoutUpdateTracing } from "test/helpers/saveHelpers";
import type { ActiveMappingInfo } from "oxalis/store";
import { askUserForLockingActiveMapping } from "oxalis/model/sagas/saga_helpers";
import { setupSavingForTracingType } from "oxalis/model/sagas/save_saga";
import { editVolumeLayerAsync, finishLayer } from "oxalis/model/sagas/volumetracing_saga";
import {
  requestBucketModificationInVolumeTracing,
  ensureMaybeActiveMappingIsLocked,
} from "oxalis/model/sagas/saga_helpers";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import { serverVolumeToClientVolumeTracing } from "oxalis/model/reducers/volumetracing_reducer";

// Mock dependencies
vi.mock("oxalis/model/sagas/root_saga", () => ({
  default: function* () {
    yield;
  },
}));

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
  annotation: {
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

describe("VolumeTracingSaga", () => {
  it("shouldn't do anything if unchanged (saga test)", () => {
    const saga = setupSavingForTracingType(
      VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
    );

    saga.next();
    saga.next(initialState.annotation.volumes[0]);
    saga.next(initialState.flycam);
    saga.next(initialState.viewModeData.plane.tdCamera);
    saga.next();
    saga.next();
    saga.next(true);
    saga.next(initialState.annotation.volumes[0]);
    saga.next(initialState.flycam);
    // only updateTracing
    const items = execCall(expect, saga.next(initialState.viewModeData.plane.tdCamera));
    expect(withoutUpdateTracing(items).length).toBe(0);
  });

  it("should do something if changed (saga test)", () => {
    const newState = VolumeTracingReducer(initialState, setActiveCellAction);
    const saga = setupSavingForTracingType(
      VolumeTracingActions.initializeVolumeTracingAction(serverVolumeTracing),
    );

    saga.next();
    saga.next(initialState.annotation.volumes[0]);
    saga.next(initialState.flycam);
    saga.next(initialState.viewModeData.plane.tdCamera);
    saga.next();
    saga.next();
    saga.next(true);
    saga.next(newState.annotation.volumes[0]);
    saga.next(newState.flycam);

    const items = execCall(expect, saga.next(newState.viewModeData.plane.tdCamera));

    expect(withoutUpdateTracing(items).length).toBe(0);
    expect(items[0].value.activeSegmentId).toBe(ACTIVE_CELL_ID);
    expectValueDeepEqual(expect, saga.next(items), put(pushSaveQueueTransaction(items)));
  });

  it("should create a volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();
    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));
    saga.next(startEditingAction);
    saga.next({
      isBusy: false,
    });
    saga.next(volumeTracing);
    saga.next(OverwriteModeEnum.OVERWRITE_ALL);
    saga.next(AnnotationTool.BRUSH);
    saga.next(false);
    // pass labeled mag
    saga.next({
      mag: [1, 1, 1],
      zoomStep: 0,
    });
    saga.next(ACTIVE_CELL_ID); // pass active cell id
    saga.next(ensureMaybeMappingIsLockedReturnValueDummy);

    expectValueDeepEqual(
      expect,
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
    const startEditingSaga = execCall(expect, saga.next());
    startEditingSaga.next();

    // Pass position
    const layer = startEditingSaga.next([1, 1, 1]).value;
    expect(layer.plane).toBe(OrthoViews.PLANE_XY);
  });

  it("should add values to volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();
    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));
    saga.next(startEditingAction);
    saga.next({
      isBusy: false,
    });
    saga.next(volumeTracing);
    saga.next(OverwriteModeEnum.OVERWRITE_ALL);
    saga.next(AnnotationTool.TRACE);
    saga.next(false);
    saga.next({
      mag: [1, 1, 1],
      zoomStep: 0,
    }); // pass labeled mag

    saga.next(ACTIVE_CELL_ID); // pass active cell id
    saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
    expectValueDeepEqual(
      expect,
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

    const volumeLayer = new VolumeLayer(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
    saga.next(volumeLayer);
    saga.next(OrthoViews.PLANE_XY);
    saga.next("action_channel");
    saga.next(addToLayerActionFn([1, 2, 3]));
    saga.next(OrthoViews.PLANE_XY);
    saga.next(addToLayerActionFn([2, 3, 4]));
    saga.next(OrthoViews.PLANE_XY);
    saga.next(addToLayerActionFn([3, 4, 5]));
    saga.next(OrthoViews.PLANE_XY);
    expect(volumeLayer.minCoord).toEqual([-1, 0, 1]);
    expect(volumeLayer.maxCoord).toEqual([5, 6, 7]);
  });

  it("should finish a volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();
    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));
    saga.next(startEditingAction);
    saga.next({
      isBusy: false,
    });
    saga.next(volumeTracing);
    saga.next(OverwriteModeEnum.OVERWRITE_ALL);
    saga.next(AnnotationTool.TRACE);
    saga.next(false);
    saga.next({
      mag: [1, 1, 1],
      zoomStep: 0,
    }); // pass labeled mag

    saga.next(ACTIVE_CELL_ID); // pass active cell id
    saga.next(ensureMaybeMappingIsLockedReturnValueDummy);
    expectValueDeepEqual(
      expect,
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

    const volumeLayer = new VolumeLayer(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
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
      expect,
      saga.next(finishEditingAction),
      call(
        finishLayer,
        volumeLayer,
        AnnotationTool.TRACE,
        ContourModeEnum.DRAW,
        OverwriteModeEnum.OVERWRITE_ALL,
        0,
        OrthoViews.PLANE_XY,
        wroteVoxelsBox,
      ),
    );
  });

  it("should finish a volume layer in delete mode (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();

    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));

    saga.next(startEditingAction);
    saga.next({
      isBusy: false,
    });
    saga.next({ ...volumeTracing, contourTracingMode: ContourModeEnum.DELETE });
    saga.next(OverwriteModeEnum.OVERWRITE_ALL);
    saga.next(AnnotationTool.TRACE);
    saga.next(false);
    saga.next({
      mag: [1, 1, 1],
      zoomStep: 0,
    }); // pass labeled mag
    saga.next(ACTIVE_CELL_ID); // pass active cell id
    saga.next(ensureMaybeMappingIsLockedReturnValueDummy);

    expectValueDeepEqual(
      expect,
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

    const volumeLayer = new VolumeLayer(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
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
      expect,
      saga.next(finishEditingAction),
      call(
        finishLayer,
        volumeLayer,
        AnnotationTool.TRACE,
        ContourModeEnum.DELETE,
        OverwriteModeEnum.OVERWRITE_ALL,
        0,
        OrthoViews.PLANE_XY,
        wroteVoxelsBox,
      ),
    );
  });

  it("should ignore brush action when busy (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();
    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));
    saga.next(startEditingAction);
    // When isBusy is true, the saga should wait for a new START_EDITING action
    // (thus, other actions, such as finishLayer, will be ignored).
    expectValueDeepEqual(
      expect,
      saga.next({
        isBusy: true,
      }),
      take("START_EDITING"),
    );
  });

  it("should lock an active mapping upon first volume annotation", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    saga.next();
    expectValueDeepEqual(expect, saga.next(true), take("START_EDITING"));
    saga.next(startEditingAction);
    saga.next({
      isBusy: false,
    });
    saga.next(volumeTracing);
    saga.next(OverwriteModeEnum.OVERWRITE_ALL);
    saga.next(AnnotationTool.BRUSH);
    saga.next(false);
    // pass labeled mag
    saga.next({
      mag: [1, 1, 1],
      zoomStep: 0,
    });
    // Test whether nested saga requestBucketModificationInVolumeTracing is called.
    expectValueDeepEqual(
      expect,
      saga.next(ACTIVE_CELL_ID),
      call(requestBucketModificationInVolumeTracing, volumeTracing),
    );
  });

  it("ensureMaybeActiveMappingIsLocked should lock an existing mapping to the annotation", () => {
    const activeMappingByLayer = { [volumeTracing.tracingId]: dummyActiveMapping };
    const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
    saga.next();
    expectValueDeepEqual(
      expect,
      saga.next({ [volumeTracing.tracingId]: dummyActiveMapping }),
      call(askUserForLockingActiveMapping, volumeTracing, activeMappingByLayer),
    );
    expect(saga.next().done).toBe(true);
  });

  it("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case no mapping is active.", () => {
    const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
    saga.next();
    expectValueDeepEqual(
      expect,
      saga.next({}),
      put(VolumeTracingActions.setMappingIsLockedAction(volumeTracing.tracingId)),
    );
    expect(saga.next().done).toBe(true);
  });

  it("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case a mapping is active but disabled.", () => {
    const jsonDummyMapping = { ...dummyActiveMapping, mappingStatus: MappingStatusEnum.DISABLED };
    const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
    saga.next();
    expectValueDeepEqual(
      expect,
      saga.next({ [volumeTracing.tracingId]: jsonDummyMapping }),
      put(VolumeTracingActions.setMappingIsLockedAction(volumeTracing.tracingId)),
    );
    expect(saga.next().done).toBe(true);
  });

  it("ensureMaybeActiveMappingIsLocked should lock 'no mapping' in case a JSON mapping is active.", () => {
    const jsonDummyMapping = { ...dummyActiveMapping, mappingType: "JSON" };
    const saga = ensureMaybeActiveMappingIsLocked(volumeTracing);
    saga.next();
    expectValueDeepEqual(
      expect,
      saga.next({ [volumeTracing.tracingId]: jsonDummyMapping }),
      put(VolumeTracingActions.setMappingIsLockedAction(volumeTracing.tracingId)),
    );
    expect(saga.next().done).toBe(true);
  });
});

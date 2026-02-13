// biome-ignore assist/source/organizeImports: the test apiHelpers need to be imported first otherwise the actual modules are loaded instead of the mocked ones
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import update from "immutability-helper";
import { call, put, take } from "redux-saga/effects";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultVolumeState } from "test/fixtures/volumetracing_object";
import { tracing as serverVolumeTracing } from "test/fixtures/volumetracing_server_objects";
import { execCall, expectValueDeepEqual } from "test/helpers/saga_test_helpers";
import {
  ContourModeEnum,
  MappingStatusEnum,
  OrthoViews,
  OverwriteModeEnum,
} from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  addToContourListAction,
  finishEditingAction,
  setActiveCellAction,
  setMappingIsLockedAction,
  startEditingAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { serverVolumeToClientVolumeTracing } from "viewer/model/reducers/volumetracing_reducer";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  askUserForLockingActiveMapping,
  ensureMaybeActiveMappingIsLocked,
  requestBucketModificationInVolumeTracing,
} from "viewer/model/sagas/saga_helpers";
import { editVolumeLayerAsync, finishSectionLabeler } from "viewer/model/sagas/volumetracing_saga";
import SectionLabeler from "viewer/model/volumetracing/section_labeling";
import { Model, Store } from "viewer/singletons";
import type { ActiveMappingInfo } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const volumeTracing = serverVolumeToClientVolumeTracing(serverVolumeTracing, null, null);

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
const setActiveCell = setActiveCellAction(ACTIVE_CELL_ID);
const startEditing = startEditingAction([0, 0, 0], OrthoViews.PLANE_XY);
const addToContourList = addToContourListAction;
const finishEditing = finishEditingAction();

const mockedDataset = update(defaultVolumeState.dataset, {
  dataSource: {
    dataLayers: {
      $set: [sampleTracingLayer],
    },
  },
});

describe("VolumeTracingSaga", () => {
  describe("With Saga Middleware", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTesting(context, "volume");
    });

    afterEach<WebknossosTestContext>(async (context) => {
      context.tearDownPullQueues();
      // Saving after each test and checking that the root saga didn't crash,
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it("shouldn't do anything if unchanged (saga test)", async (context: WebknossosTestContext) => {
      await Model.ensureSavedState();
      expect(context.receivedDataPerSaveRequest.length).toBe(0);
    });

    it("should do something if changed (saga test)", async (context: WebknossosTestContext) => {
      Store.dispatch(setActiveCell);
      await Model.ensureSavedState();
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      const requestBatches = context.receivedDataPerSaveRequest[0];
      expect(requestBatches.length).toBe(1);
      const updateBatch = requestBatches[0];
      expect(updateBatch.actions.map((action) => action.name)).toEqual(["updateActiveSegmentId"]);
      const action = updateBatch.actions[0];

      expect(action).toMatchObject({
        name: "updateActiveSegmentId",
        value: {
          actionTracingId: volumeTracing.tracingId,
          activeSegmentId: 5,
        },
      });
    });
  });

  it("should create a volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
        updateSegmentAction(
          ACTIVE_CELL_ID,
          {
            anchorPosition: startEditing.positionInLayerSpace,
            additionalCoordinates: [],
          },
          volumeTracing.tracingId,
        ),
      ),
    );
    const createSectionLabelerSaga = execCall(expect, saga.next());
    createSectionLabelerSaga.next(); // kick off saga
    createSectionLabelerSaga.next(mockedDataset);

    // Pass datasource config
    const labeller = createSectionLabelerSaga.next({ nativelyRenderedLayerName: undefined }).value;
    expect(labeller.getPlane()).toBe(OrthoViews.PLANE_XY);
  });

  it("should add values to volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
        updateSegmentAction(
          ACTIVE_CELL_ID,
          {
            anchorPosition: startEditing.positionInLayerSpace,
            additionalCoordinates: [],
          },
          volumeTracing.tracingId,
        ),
      ),
    );
    saga.next(); // advance from the put action

    const sectionLabeler = new SectionLabeler(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
    saga.next(sectionLabeler);
    saga.next(OrthoViews.PLANE_XY);
    saga.next("action_channel");
    saga.next(addToContourList([1, 2, 3]));
    saga.next(OrthoViews.PLANE_XY);
    saga.next(addToContourList([2, 3, 4]));
    saga.next(OrthoViews.PLANE_XY);
    saga.next(addToContourList([3, 4, 5]));
    saga.next(OrthoViews.PLANE_XY);
    expect(sectionLabeler.minCoord).toEqual([-1, 0, 1]);
    expect(sectionLabeler.maxCoord).toEqual([5, 6, 7]);
  });

  it("should finish a volume layer (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
        updateSegmentAction(
          ACTIVE_CELL_ID,
          {
            anchorPosition: startEditing.positionInLayerSpace,
            additionalCoordinates: [],
          },
          volumeTracing.tracingId,
        ),
      ),
    );
    saga.next(); // advance from the put action

    const sectionLabeler = new SectionLabeler(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
    saga.next(sectionLabeler);
    saga.next(OrthoViews.PLANE_XY);
    saga.next("action_channel");
    saga.next(addToContourList([1, 2, 3]));
    saga.next(OrthoViews.PLANE_XY);
    // Validate that finishLayer was called
    const wroteVoxelsBox = {
      value: false,
    };
    expectValueDeepEqual(
      expect,
      saga.next(finishEditing),
      call(
        finishSectionLabeler,
        sectionLabeler,
        AnnotationTool.TRACE,
        ContourModeEnum.DRAW,
        OverwriteModeEnum.OVERWRITE_ALL,
        0,
        wroteVoxelsBox,
      ),
    );
  });

  it("should finish a volume layer in delete mode (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
        updateSegmentAction(
          ACTIVE_CELL_ID,
          {
            anchorPosition: startEditing.positionInLayerSpace,
            additionalCoordinates: [],
          },
          volumeTracing.tracingId,
        ),
      ),
    );
    saga.next(); // advance from the put action

    const sectionLabeler = new SectionLabeler(
      volumeTracing.tracingId,
      OrthoViews.PLANE_XY,
      10,
      [1, 1, 1],
    );
    saga.next(sectionLabeler);
    saga.next(OrthoViews.PLANE_XY);
    saga.next("action_channel");
    saga.next(addToContourList([1, 2, 3]));
    saga.next(OrthoViews.PLANE_XY);
    const wroteVoxelsBox = {
      value: false,
    };
    // Validate that finishLayer was called
    expectValueDeepEqual(
      expect,
      saga.next(finishEditing),
      call(
        finishSectionLabeler,
        sectionLabeler,
        AnnotationTool.TRACE,
        ContourModeEnum.DELETE,
        OverwriteModeEnum.OVERWRITE_ALL,
        0,
        wroteVoxelsBox,
      ),
    );
  });

  it("should ignore brush action when busy (saga test)", () => {
    const saga = editVolumeLayerAsync();
    saga.next();
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
    expectValueDeepEqual(expect, saga.next(), take("START_EDITING"));
    saga.next(startEditing);
    saga.next(true);
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
      put(setMappingIsLockedAction(volumeTracing.tracingId)),
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
      put(setMappingIsLockedAction(volumeTracing.tracingId)),
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
      put(setMappingIsLockedAction(volumeTracing.tracingId)),
    );
    expect(saga.next().done).toBe(true);
  });
});

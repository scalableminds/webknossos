// @ts-nocheck
import update from "immutability-helper";
import { getFirstVolumeTracingOrFail } from "test/helpers/apiHelpers";
import { AnnotationToolEnum } from "oxalis/constants";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import * as UiActions from "oxalis/model/actions/ui_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import mockRequire from "mock-require";
import test from "ava";
import { initialState } from "test/fixtures/volumetracing_object";
mockRequire("app", {
  currentUser: {
    firstName: "SCM",
    lastName: "Boy",
  },
});
test("VolumeTracing should set a new active cell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction();
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(1);
  // Create two cells, then set first one active
  let newState = VolumeTracingReducer(initialState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, setActiveCellAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => t.is(tracing.activeCellId, 1));
});
test("VolumeTracing should set a new active cell, which did not exist before", (t) => {
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(10);
  // Set a cell active which did not exist before
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.activeCellId, 10);
  });
});
test("VolumeTracing should set active but not create a cell 0", (t) => {
  const setActiveCellActionFn = VolumeTracingActions.setActiveCellAction;
  // Set activeCellId to 1 and back to 0
  let newState = VolumeTracingReducer(initialState, setActiveCellActionFn(1));
  newState = VolumeTracingReducer(newState, setActiveCellActionFn(0));
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    // There should be no cell with the id 0 as it is reserved for "no annotation"
    t.is(tracing.activeCellId, 0);
  });
});
test("VolumeTracing should create a cell and set it as the activeCell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.tracing.volumes[0].largestSegmentId,
  );
  // Create cell
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.activeCellId, 1);
  });
});
test("VolumeTracing should create a non-existing cell id and not update the largestSegmentId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.tracing.volumes[0].largestSegmentId,
  );
  // Create a cell with an id that is higher than the largestSegmentId
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.largestSegmentId, 0);
  });
});
test("VolumeTracing should create an existing cell and not update the largestSegmentId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.tracing.volumes[0].largestSegmentId,
  );
  const alteredState = update(initialState, {
    tracing: {
      volumes: {
        "0": {
          largestSegmentId: {
            $set: 5,
          },
        },
      },
    },
  });
  // Create cell with an id that is lower than the largestSegmentId
  const newState = VolumeTracingReducer(alteredState, createCellAction);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.largestSegmentId, 5);
  });
});
test("VolumeTracing should create cells and only update the largestSegmentId after a voxel was annotated", (t) => {
  const LARGEST_SEGMENT_ID = 5;
  const createCellAction = VolumeTracingActions.createCellAction(LARGEST_SEGMENT_ID);
  const finishAnnotationStrokeAction =
    VolumeTracingActions.finishAnnotationStrokeAction("tracingId");
  const alteredState = update(initialState, {
    tracing: {
      volumes: {
        "0": {
          largestSegmentId: {
            $set: LARGEST_SEGMENT_ID,
          },
        },
      },
    },
  });
  // Create two cells without specifying an id
  let newState = VolumeTracingReducer(alteredState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  // The largestSegmentId should not be updated, since no voxel was annotated yet
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.largestSegmentId, 5);
  });
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, finishAnnotationStrokeAction);
  // The largestSegmentId should be updated, since a voxel was annotated with id 8
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.is(tracing.largestSegmentId, 8);
  });
});
test("VolumeTracing should set trace/view tool", (t) => {
  const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);
  // Change tool to Trace
  const newState = UiReducer(initialState, setToolAction);
  t.not(newState, initialState);
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.TRACE);
});
test("VolumeTracing should not allow to set trace tool if getRequestLogZoomStep(zoomStep) is > 1", (t) => {
  const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: {
        $set: 3,
      },
    },
  });
  t.true(getRequestLogZoomStep(alteredState) > 1);
  // Try to change tool to Trace
  const newState = UiReducer(alteredState, setToolAction);
  t.is(alteredState, newState);
  // Tool should not have changed
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.MOVE);
});
test("VolumeTracing should cycle trace/view/brush tool", (t) => {
  const cycleToolAction = () => UiActions.cycleToolAction();

  // Cycle tool to Brush
  let newState = UiReducer(initialState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.BRUSH);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.ERASE_BRUSH);
  // Cycle tool to Trace
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.TRACE);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.ERASE_TRACE);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.FILL_CELL);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.PICK_CELL);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.BOUNDING_BOX);
  // Cycle tool back to MOVE
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationToolEnum.MOVE);
});
test("VolumeTracing should update its lastLabelActions", (t) => {
  const direction = [4, 6, 9];
  const registerLabelPointAction = VolumeTracingActions.registerLabelPointAction(direction);
  // Update direction
  const newState = VolumeTracingReducer(initialState, registerLabelPointAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.lastLabelActions[0].centroid, direction);
  });
});

const prepareContourListTest = (t, state) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  let newState = VolumeTracingReducer(state, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  return {
    newState,
    contourList,
  };
};

test("VolumeTracing should add values to the contourList", (t) => {
  const { newState, contourList } = prepareContourListTest(t, initialState);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.contourList, contourList);
  });
});
test("VolumeTracing should add values to the contourList even if getRequestLogZoomStep(zoomStep) > 1", (t) => {
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: {
        $set: 3,
      },
    },
  });
  t.true(getRequestLogZoomStep(alteredState) > 1);
  const { newState, contourList } = prepareContourListTest(t, alteredState);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.contourList, contourList);
  });
});
test("VolumeTracing should not add values to the contourList if volumetracing is not allowed", (t) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const alteredState = update(initialState, {
    tracing: {
      restrictions: {
        allowUpdate: {
          $set: false,
        },
      },
    },
  });
  // Try to add positions to the contourList
  let newState = VolumeTracingReducer(alteredState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  t.is(newState, alteredState);
});
test("VolumeTracing should reset contourList", (t) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const resetContourAction = VolumeTracingActions.resetContourAction();
  // Add positions to the contourList
  let newState = VolumeTracingReducer(initialState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  // And reset the list
  newState = VolumeTracingReducer(newState, resetContourAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.tracing).map((tracing) => {
    t.deepEqual(tracing.contourList, []);
  });
});
export default {};

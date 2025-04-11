import "test/mocks/lz4";
import update from "immutability-helper";
import Maybe from "data.maybe";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import type { Vector3 } from "oxalis/constants";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import * as UiActions from "oxalis/model/actions/ui_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import test from "ava";
import { initialState } from "test/fixtures/volumetracing_object";
import type { OxalisState, StoreAnnotation, VolumeTracing } from "oxalis/store";
import { getActiveMagIndexForLayer } from "oxalis/model/accessors/flycam_accessor";

// biome-ignore lint/suspicious/noExportsInTest:
export function getFirstVolumeTracingOrFail(annotation: StoreAnnotation): Maybe<VolumeTracing> {
  if (annotation.volumes.length > 0) {
    return Maybe.Just(annotation.volumes[0]);
  }

  throw new Error("Annotation is not of type volume!");
}

test("VolumeTracing should set a new active cell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(1000, 1000);
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(1);
  // Create two cells, then set first one active
  let newState = VolumeTracingReducer(initialState, createCellAction);
  newState = VolumeTracingReducer(newState, createCellAction);
  newState = VolumeTracingReducer(newState, setActiveCellAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => t.is(tracing.activeCellId, 1));
});

test("VolumeTracing should set a new active cell, which did not exist before", (t) => {
  const setActiveCellAction = VolumeTracingActions.setActiveCellAction(10);
  // Set a cell active which did not exist before
  const newState = VolumeTracingReducer(initialState, setActiveCellAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.activeCellId, 10);
  });
});

test("VolumeTracing should set active but not create a cell 0", (t) => {
  const setActiveCellActionFn = VolumeTracingActions.setActiveCellAction;
  // Set activeCellId to 1 and back to 0
  let newState = VolumeTracingReducer(initialState, setActiveCellActionFn(1));
  newState = VolumeTracingReducer(newState, setActiveCellActionFn(0));
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    // There should be no cell with the id 0 as it is reserved for "no annotation"
    t.is(tracing.activeCellId, 0);
  });
});

test("VolumeTracing should create a cell and set it as the activeCell", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.annotation.volumes[0].activeCellId as number,
    initialState.annotation.volumes[0].largestSegmentId as number,
  );
  // Create cell
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.activeCellId, 1);
  });
});

test("VolumeTracing should create a non-existing cell id and not update the largestSegmentId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.annotation.volumes[0].activeCellId as number,
    initialState.annotation.volumes[0].largestSegmentId as number,
  );
  // Create a cell with an id that is higher than the largestSegmentId
  const newState = VolumeTracingReducer(initialState, createCellAction);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.largestSegmentId, 0);
  });
});

test("VolumeTracing should create an existing cell and not update the largestSegmentId", (t) => {
  const createCellAction = VolumeTracingActions.createCellAction(
    initialState.annotation.volumes[0].activeCellId as number,
    initialState.annotation.volumes[0].largestSegmentId as number,
  );
  const alteredState = update(initialState, {
    annotation: {
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
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.largestSegmentId, 5);
  });
});

test("VolumeTracing should create cells and only update the largestSegmentId after a voxel was annotated", (t) => {
  const LARGEST_SEGMENT_ID = 5;
  const getCreateCellAction = (state: OxalisState) =>
    VolumeTracingActions.createCellAction(
      state.annotation.volumes[0].activeCellId as number,
      LARGEST_SEGMENT_ID,
    );
  const finishAnnotationStrokeAction =
    VolumeTracingActions.finishAnnotationStrokeAction("tracingId");
  const alteredState = update(initialState, {
    annotation: {
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
  let newState = VolumeTracingReducer(alteredState, getCreateCellAction(alteredState));
  newState = VolumeTracingReducer(newState, getCreateCellAction(newState));
  // The largestSegmentId should not be updated, since no voxel was annotated yet
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.largestSegmentId, LARGEST_SEGMENT_ID);
  });
  newState = VolumeTracingReducer(newState, getCreateCellAction(newState));
  newState = VolumeTracingReducer(newState, finishAnnotationStrokeAction);
  // The largestSegmentId should be updated, since a voxel was annotated with id 8
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.is(tracing.largestSegmentId, 8);
  });
});

test("VolumeTracing should set trace/view tool", (t) => {
  const setToolAction = UiActions.setToolAction(AnnotationTool.TRACE);
  // Change tool to Trace
  const newState = UiReducer(initialState, setToolAction);
  t.not(newState, initialState);
  t.is(newState.uiInformation.activeTool, AnnotationTool.TRACE);
});

test("VolumeTracing should not allow to set trace tool if getActiveMagIndexForLayer(zoomStep, 'tracingId') is > 1", (t) => {
  const setToolAction = UiActions.setToolAction(AnnotationTool.TRACE);
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: {
        $set: 5,
      },
    },
  });

  t.true(getActiveMagIndexForLayer(alteredState, "tracingId") > 1);
  // Try to change tool to Trace
  const newState = UiReducer(alteredState, setToolAction);
  t.is(alteredState, newState);
  // Tool should not have changed
  t.is(newState.uiInformation.activeTool, AnnotationTool.MOVE);
});

test("VolumeTracing should cycle trace/view/brush tool", (t) => {
  const cycleToolAction = () => UiActions.cycleToolAction();

  // Cycle tool to Brush
  let newState = UiReducer(initialState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.BRUSH);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.ERASE_BRUSH);
  // Cycle tool to Trace
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.TRACE);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.ERASE_TRACE);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.FILL_CELL);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.PICK_CELL);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.QUICK_SELECT);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.BOUNDING_BOX);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.LINE_MEASUREMENT);
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.AREA_MEASUREMENT);
  // Cycle tool back to MOVE
  newState = UiReducer(newState, cycleToolAction());
  t.is(newState.uiInformation.activeTool, AnnotationTool.MOVE);
});

test("VolumeTracing should update its lastLabelActions", (t) => {
  const direction = [4, 6, 9] as Vector3;
  const registerLabelPointAction = VolumeTracingActions.registerLabelPointAction(direction);
  // Update direction
  const newState = VolumeTracingReducer(initialState, registerLabelPointAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.deepEqual(tracing.lastLabelActions[0].centroid, direction);
  });
});

const prepareContourListTest = (_t: any, state: OxalisState) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ] as Vector3[];
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
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.deepEqual(tracing.contourList, contourList);
  });
});

test("VolumeTracing should add values to the contourList even if getActiveMagIndexForLayer(zoomStep, 'tracingId') > 1", (t) => {
  const alteredState = update(initialState, {
    flycam: {
      zoomStep: {
        $set: 8,
      },
    },
  });
  t.true(getActiveMagIndexForLayer(alteredState, "tracingId") > 1);
  const { newState, contourList } = prepareContourListTest(t, alteredState);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.deepEqual(tracing.contourList, contourList);
  });
});

test("VolumeTracing should not add values to the contourList if volumetracing is not allowed", (t) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ] as Vector3[];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const alteredState = update(initialState, {
    annotation: {
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
  ] as Vector3[];
  const addToLayerActionFn = VolumeTracingActions.addToLayerAction;
  const resetContourAction = VolumeTracingActions.resetContourAction();
  // Add positions to the contourList
  let newState = VolumeTracingReducer(initialState, addToLayerActionFn(contourList[0]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[1]));
  newState = VolumeTracingReducer(newState, addToLayerActionFn(contourList[2]));
  // And reset the list
  newState = VolumeTracingReducer(newState, resetContourAction);
  t.not(newState, initialState);
  getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
    t.deepEqual(tracing.contourList, []);
  });
});

// export default {};

import update from "immutability-helper";
import Maybe from "data.maybe";
import { AnnotationToolEnum, type Vector3 } from "oxalis/constants";
import * as VolumeTracingActions from "oxalis/model/actions/volumetracing_actions";
import * as UiActions from "oxalis/model/actions/ui_actions";
import VolumeTracingReducer from "oxalis/model/reducers/volumetracing_reducer";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import { describe, it, expect } from "vitest";
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

describe("VolumeTracing", () => {
  it("should set a new active cell", () => {
    const createCellAction = VolumeTracingActions.createCellAction(1000, 1000);
    const setActiveCellAction = VolumeTracingActions.setActiveCellAction(1);
    // Create two cells, then set first one active
    let newState = VolumeTracingReducer(initialState, createCellAction);
    newState = VolumeTracingReducer(newState, createCellAction);
    newState = VolumeTracingReducer(newState, setActiveCellAction);
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) =>
      expect(tracing.activeCellId).toBe(1),
    );
  });

  it("should set a new active cell, which did not exist before", () => {
    const setActiveCellAction = VolumeTracingActions.setActiveCellAction(10);
    // Set a cell active which did not exist before
    const newState = VolumeTracingReducer(initialState, setActiveCellAction);
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.activeCellId).toBe(10);
    });
  });

  it("should set active but not create a cell 0", () => {
    const setActiveCellActionFn = VolumeTracingActions.setActiveCellAction;
    // Set activeCellId to 1 and back to 0
    let newState = VolumeTracingReducer(initialState, setActiveCellActionFn(1));
    newState = VolumeTracingReducer(newState, setActiveCellActionFn(0));
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      // There should be no cell with the id 0 as it is reserved for "no annotation"
      expect(tracing.activeCellId).toBe(0);
    });
  });

  it("should create a cell and set it as the activeCell", () => {
    const createCellAction = VolumeTracingActions.createCellAction(
      initialState.annotation.volumes[0].activeCellId as number,
      initialState.annotation.volumes[0].largestSegmentId as number,
    );
    // Create cell
    const newState = VolumeTracingReducer(initialState, createCellAction);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.activeCellId).toBe(1);
    });
  });

  it("should create a non-existing cell id and not update the largestSegmentId", () => {
    const createCellAction = VolumeTracingActions.createCellAction(
      initialState.annotation.volumes[0].activeCellId as number,
      initialState.annotation.volumes[0].largestSegmentId as number,
    );
    // Create a cell with an id that is higher than the largestSegmentId
    const newState = VolumeTracingReducer(initialState, createCellAction);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.largestSegmentId).toBe(0);
    });
  });

  it("should create an existing cell and not update the largestSegmentId", () => {
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
      expect(tracing.largestSegmentId).toBe(5);
    });
  });

  it("should create cells and only update the largestSegmentId after a voxel was annotated", () => {
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
      expect(tracing.largestSegmentId).toBe(LARGEST_SEGMENT_ID);
    });
    newState = VolumeTracingReducer(newState, getCreateCellAction(newState));
    newState = VolumeTracingReducer(newState, finishAnnotationStrokeAction);
    // The largestSegmentId should be updated, since a voxel was annotated with id 8
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.largestSegmentId).toBe(8);
    });
  });

  it("should set trace/view tool", () => {
    const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);
    // Change tool to Trace
    const newState = UiReducer(initialState, setToolAction);
    expect(newState).not.toBe(initialState);
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.TRACE);
  });

  it("should not allow to set trace tool if getActiveMagIndexForLayer(zoomStep, 'tracingId') is > 1", () => {
    const setToolAction = UiActions.setToolAction(AnnotationToolEnum.TRACE);
    const alteredState = update(initialState, {
      flycam: {
        zoomStep: {
          $set: 5,
        },
      },
    });

    expect(getActiveMagIndexForLayer(alteredState, "tracingId") > 1).toBe(true);
    // Try to change tool to Trace
    const newState = UiReducer(alteredState, setToolAction);
    expect(alteredState).toBe(newState);
    // Tool should not have changed
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.MOVE);
  });

  it("should cycle trace/view/brush tool", () => {
    const cycleToolAction = () => UiActions.cycleToolAction();

    // Cycle tool to Brush
    let newState = UiReducer(initialState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.BRUSH);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.ERASE_BRUSH);
    // Cycle tool to Trace
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.TRACE);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.ERASE_TRACE);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.FILL_CELL);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.PICK_CELL);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.QUICK_SELECT);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.BOUNDING_BOX);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.LINE_MEASUREMENT);
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.AREA_MEASUREMENT);
    // Cycle tool back to MOVE
    newState = UiReducer(newState, cycleToolAction());
    expect(newState.uiInformation.activeTool).toBe(AnnotationToolEnum.MOVE);
  });

  it("should update its lastLabelActions", () => {
    const direction = [4, 6, 9] as Vector3;
    const registerLabelPointAction = VolumeTracingActions.registerLabelPointAction(direction);
    // Update direction
    const newState = VolumeTracingReducer(initialState, registerLabelPointAction);
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.lastLabelActions[0].centroid).toEqual(direction);
    });
  });

  it("should add values to the contourList", () => {
    const { newState, contourList } = prepareContourListTest(initialState);
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.contourList).toEqual(contourList);
    });
  });

  it("should add values to the contourList even if getActiveMagIndexForLayer(zoomStep, 'tracingId') > 1", () => {
    const alteredState = update(initialState, {
      flycam: {
        zoomStep: {
          $set: 8,
        },
      },
    });
    expect(getActiveMagIndexForLayer(alteredState, "tracingId") > 1).toBe(true);
    const { newState, contourList } = prepareContourListTest(alteredState);
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.contourList).toEqual(contourList);
    });
  });

  it("should not add values to the contourList if volumetracing is not allowed", () => {
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
    expect(newState).toBe(alteredState);
  });

  it("should reset contourList", () => {
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
    expect(newState).not.toBe(initialState);
    getFirstVolumeTracingOrFail(newState.annotation).map((tracing) => {
      expect(tracing.contourList).toEqual([]);
    });
  });
});

const prepareContourListTest = (state: OxalisState) => {
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

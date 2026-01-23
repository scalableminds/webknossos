import update from "immutability-helper";
import type { Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  addToContourListAction,
  createCellAction,
  finishAnnotationStrokeAction,
  mergeSegmentsAction,
  registerLabelPointAction,
  resetContourAction,
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { cycleToolAction, setToolAction } from "viewer/model/actions/ui_actions";
import VolumeTracingReducer from "viewer/model/reducers/volumetracing_reducer";
import UiReducer from "viewer/model/reducers/ui_reducer";
import { describe, it, expect } from "vitest";
import { initialState, VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import type { WebknossosState, StoreAnnotation, VolumeTracing, Segment } from "viewer/store";
import { getActiveMagIndexForLayer } from "viewer/model/accessors/flycam_accessor";

// biome-ignore lint/suspicious/noExportsInTest:
export function getFirstVolumeTracingOrFail(annotation: StoreAnnotation): VolumeTracing {
  if (annotation.volumes.length > 0) {
    return annotation.volumes[0];
  }

  throw new Error("Annotation is not of type volume!");
}

const INITIAL_LARGEST_SEGMENT_ID = initialState.annotation.volumes[0].largestSegmentId ?? 0;

describe("VolumeTracing", () => {
  it("should set a new active cell", () => {
    const createCell = createCellAction(1000, 1000);
    const setActiveCell = setActiveCellAction(1);

    // Create two cells, then set first one active
    let newState = VolumeTracingReducer(initialState, createCell);
    newState = VolumeTracingReducer(newState, createCell);
    newState = VolumeTracingReducer(newState, setActiveCell);
    expect(newState).not.toBe(initialState);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.activeCellId).toBe(1);
  });

  it("should set a new active cell, which did not exist before", () => {
    const setActiveCell = setActiveCellAction(10);

    // Set a cell active which did not exist before
    const newState = VolumeTracingReducer(initialState, setActiveCell);
    expect(newState).not.toBe(initialState);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.activeCellId).toBe(10);
  });

  it("should set active but not create a cell 0", () => {
    const setActiveCell = setActiveCellAction;

    // Set activeCellId to 1 and back to 0
    let newState = VolumeTracingReducer(initialState, setActiveCell(1));
    newState = VolumeTracingReducer(newState, setActiveCell(0));

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    // There should be no cell with the id 0 as it is reserved for "no annotation"
    expect(tracing.activeCellId).toBe(0);
  });

  it("should create a cell and set it as the activeCell", () => {
    const createCell = createCellAction(
      initialState.annotation.volumes[0].activeCellId as number,
      initialState.annotation.volumes[0].largestSegmentId as number,
    );

    // Create cell
    const newState = VolumeTracingReducer(initialState, createCell);
    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.activeCellId).toBe(INITIAL_LARGEST_SEGMENT_ID + 1);
  });

  it("should create a non-existing cell id and not update the largestSegmentId", () => {
    const createCell = createCellAction(
      initialState.annotation.volumes[0].activeCellId as number,
      initialState.annotation.volumes[0].largestSegmentId as number,
    );

    // Create a cell with an id that is higher than the largestSegmentId
    const newState = VolumeTracingReducer(initialState, createCell);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.largestSegmentId).toBe(INITIAL_LARGEST_SEGMENT_ID);
  });

  it("should create an existing cell and not update the largestSegmentId", () => {
    const createCell = createCellAction(
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
    const newState = VolumeTracingReducer(alteredState, createCell);
    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.largestSegmentId).toBe(5);
  });

  it("should create cells and only update the largestSegmentId after a voxel was annotated", () => {
    const LARGEST_SEGMENT_ID = 5;
    const getCreateCell = (state: WebknossosState) =>
      createCellAction(state.annotation.volumes[0].activeCellId as number, LARGEST_SEGMENT_ID);
    const finishAnnotationStroke = finishAnnotationStrokeAction(VOLUME_TRACING_ID);
    const alteredState = update(initialState, {
      annotation: {
        volumes: {
          "0": {
            largestSegmentId: {
              $set: LARGEST_SEGMENT_ID,
            },
            activeCellId: {
              $set: LARGEST_SEGMENT_ID,
            },
          },
        },
      },
    });

    // Create two cells without specifying an id
    let newState = VolumeTracingReducer(alteredState, getCreateCell(alteredState));
    newState = VolumeTracingReducer(newState, getCreateCell(newState));

    // The largestSegmentId should not be updated, since no voxel was annotated yet
    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.largestSegmentId).toBe(LARGEST_SEGMENT_ID);

    newState = VolumeTracingReducer(newState, getCreateCell(newState));
    newState = VolumeTracingReducer(newState, finishAnnotationStroke);

    // The largestSegmentId should be updated, since a voxel was annotated with id 8
    const tracing2 = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing2.largestSegmentId).toBe(8);
  });

  it("should set trace/view tool", () => {
    const setTool = setToolAction(AnnotationTool.TRACE);
    // Change tool to Trace
    const newState = UiReducer(initialState, setTool);
    expect(newState).not.toBe(initialState);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.TRACE);
  });

  it("should not allow to set trace tool if getActiveMagIndexForLayer(zoomStep, 'tracingId') is > 1", () => {
    const setTool = setToolAction(AnnotationTool.TRACE);
    const alteredState = update(initialState, {
      flycam: {
        zoomStep: {
          $set: 5,
        },
      },
    });

    expect(getActiveMagIndexForLayer(alteredState, VOLUME_TRACING_ID) > 1).toBe(true);

    // Try to change tool to Trace
    const newState = UiReducer(alteredState, setTool);
    expect(alteredState).toBe(newState);

    // Tool should not have changed
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.MOVE);
  });

  it("should cycle trace/view/brush tool", () => {
    const cycleTool = cycleToolAction();

    // Cycle tool to Brush
    let newState = UiReducer(initialState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.BRUSH);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.ERASE_BRUSH);

    // Cycle tool to Trace
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.TRACE);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.ERASE_TRACE);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.FILL_CELL);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.VOXEL_PIPETTE);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.QUICK_SELECT);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.BOUNDING_BOX);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.LINE_MEASUREMENT);
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.AREA_MEASUREMENT);

    // Cycle tool back to MOVE
    newState = UiReducer(newState, cycleTool);
    expect(newState.uiInformation.activeTool).toBe(AnnotationTool.MOVE);
  });

  it("should update its lastLabelActions", () => {
    const direction = [4, 6, 9] as Vector3;
    const registerLabelPoint = registerLabelPointAction(direction);

    // Update direction
    const newState = VolumeTracingReducer(initialState, registerLabelPoint);
    expect(newState).not.toBe(initialState);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.lastLabelActions[0].centroid).toEqual(direction);
  });

  it("should add values to the contourList", () => {
    const { newState, contourList } = prepareContourListTest(initialState);
    expect(newState).not.toBe(initialState);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.contourList).toEqual(contourList);
  });

  it("should add values to the contourList even if getActiveMagIndexForLayer(zoomStep, 'tracingId') > 1", () => {
    const alteredState = update(initialState, {
      flycam: {
        zoomStep: {
          $set: 8,
        },
      },
    });
    expect(getActiveMagIndexForLayer(alteredState, VOLUME_TRACING_ID) > 1).toBe(true);

    const { newState, contourList } = prepareContourListTest(alteredState);
    expect(newState).not.toBe(initialState);

    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.contourList).toEqual(contourList);
  });

  it("should not add values to the contourList if volumetracing is not allowed", () => {
    const contourList = [
      [4, 6, 9],
      [1, 2, 3],
      [9, 3, 2],
    ] as Vector3[];
    const addToContourList = addToContourListAction;
    const alteredState = update(initialState, {
      annotation: {
        isUpdatingCurrentlyAllowed: {
          $set: false,
        },
      },
    });

    // Try to add positions to the contourList
    let newState = VolumeTracingReducer(alteredState, addToContourList(contourList[0]));
    newState = VolumeTracingReducer(newState, addToContourList(contourList[1]));
    newState = VolumeTracingReducer(newState, addToContourList(contourList[2]));
    expect(newState).toBe(alteredState);
  });

  it("should reset contourList", () => {
    const contourList = [
      [4, 6, 9],
      [1, 2, 3],
      [9, 3, 2],
    ] as Vector3[];
    const addToContourList = addToContourListAction;
    const resetContour = resetContourAction();

    // Add positions to the contourList
    let newState = VolumeTracingReducer(initialState, addToContourList(contourList[0]));
    newState = VolumeTracingReducer(newState, addToContourList(contourList[1]));
    newState = VolumeTracingReducer(newState, addToContourList(contourList[2]));

    // And reset the list
    newState = VolumeTracingReducer(newState, resetContour);
    expect(newState).not.toBe(initialState);
    const tracing = getFirstVolumeTracingOrFail(newState.annotation);
    expect(tracing.contourList).toEqual([]);
  });

  describe("should merge segments", () => {
    const getSegment = (state: WebknossosState, id: number) =>
      state.annotation.volumes[0].segments.getNullable(id);
    const createAction = (id: number, properties: Partial<Segment>) =>
      updateSegmentAction(
        id,
        {
          anchorPosition: [id, id, id],
          groupId: id,
          ...properties,
        },
        VOLUME_TRACING_ID,
        undefined,
        true,
      );

    const [id1, id2] = [1, 2];
    const createSegment1 = createAction(id1, {
      name: "Name 1",
      metadata: [
        { key: "someKey1", stringValue: "someStringValue" },
        { key: "someKey2", stringListValue: ["list", "value"] },
      ],
    });
    const createSegment2 = createAction(id2, {
      name: "Name 2",
      metadata: [
        { key: "someKey1", stringValue: "someStringValue" },
        { key: "someKey3", stringListValue: ["list", "value"] },
      ],
    });

    it("should merge two segments (simple)", () => {
      let newState = VolumeTracingReducer(initialState, createSegment1);
      newState = VolumeTracingReducer(newState, createSegment2);
      newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));

      const segment1 = getSegment(newState, id1);
      const segment2 = getSegment(newState, id2);

      expect(segment1).toMatchObject({
        id: id1,
        groupId: id1,
        name: "Name 1 and Name 2",
        metadata: [
          { key: "someKey1-1", stringValue: "someStringValue" },
          { key: "someKey2", stringListValue: ["list", "value"] },
          { key: "someKey1-2", stringValue: "someStringValue" },
          { key: "someKey3", stringListValue: ["list", "value"] },
        ],
        anchorPosition: [1, 1, 1],
      });
      expect(segment2).toBeUndefined();
    });

    it("should merge two segments (segment 1 doesn't exist, though)", () => {
      let newState = VolumeTracingReducer(initialState, createSegment2);
      newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));

      const segment1 = getSegment(newState, id1);
      const segment2 = getSegment(newState, id2);

      expect(segment1).toMatchObject({
        id: id1,
        groupId: id2,
        name: "Segment 1 and Name 2", // Note that "Segment 1" as a fallback got used here.
        metadata: [
          { key: "someKey1", stringValue: "someStringValue" },
          { key: "someKey3", stringListValue: ["list", "value"] },
        ],
        anchorPosition: [2, 2, 2],
      });
      expect(segment2).toBeUndefined();
    });

    it("should merge two segments (segment 2 doesn't exist, though)", () => {
      let newState = VolumeTracingReducer(initialState, createSegment1);
      const segment1BeforeMerge = getSegment(newState, id1);
      newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));

      const segment1 = getSegment(newState, id1);
      const segment2 = getSegment(newState, id2);

      expect(segment1).toEqual(segment1BeforeMerge);
      expect(segment2).toBeUndefined();
    });
  });
});

const prepareContourListTest = (state: WebknossosState) => {
  const contourList = [
    [4, 6, 9],
    [1, 2, 3],
    [9, 3, 2],
  ] as Vector3[];
  const addToContourList = addToContourListAction;

  let newState = VolumeTracingReducer(state, addToContourList(contourList[0]));
  newState = VolumeTracingReducer(newState, addToContourList(contourList[1]));
  newState = VolumeTracingReducer(newState, addToContourList(contourList[2]));

  return {
    newState,
    contourList,
  };
};

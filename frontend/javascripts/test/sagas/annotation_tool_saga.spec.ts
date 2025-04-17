import { describe, it, beforeEach, expect, vi } from "vitest";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import { initialState } from "test/fixtures/volumetracing_object";

const disabledInfoMock: { [key in any]?: any } = {};

Object.values(AnnotationTool).forEach((annotationTool) => {
  disabledInfoMock[annotationTool.id] = {
    isDisabled: false,
    explanation: "",
  };
});

vi.mock("oxalis/model/accessors/disabled_tool_accessor", () => ({
  getDisabledInfoForTools: () => disabledInfoMock,
}));

vi.mock("oxalis/controller/scene_controller_provider", () => ({
  default: () => ({
    lineMeasurementGeometry: {
      hide: vi.fn(),
      reset: vi.fn(),
      resetAndHide: vi.fn(),
    },
    areaMeasurementGeometry: {
      hide: vi.fn(),
      reset: vi.fn(),
      resetAndHide: vi.fn(),
    },
  }),
}));

// Import the modules after mocking
import {
  MoveToolController,
  SkeletonToolController,
  BoundingBoxToolController,
  DrawToolController,
  EraseToolController,
  FillCellToolController,
  PickCellToolController,
  QuickSelectToolController,
  ProofreadToolController,
  LineMeasurementToolController,
  AreaMeasurementToolController,
} from "oxalis/controller/combinations/tool_controls";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { cycleToolAction, setToolAction } from "oxalis/model/actions/ui_actions";
import { watchToolDeselection } from "oxalis/model/sagas/annotation_tool_saga";

describe("Annotation Tool Saga", () => {
  const allToolControllers = [
    MoveToolController,
    SkeletonToolController,
    BoundingBoxToolController,
    DrawToolController,
    EraseToolController,
    FillCellToolController,
    PickCellToolController,
    QuickSelectToolController,
    ProofreadToolController,
    LineMeasurementToolController,
    AreaMeasurementToolController,
  ];

  const spies = allToolControllers.map((tool) => vi.spyOn(tool, "onToolDeselected"));

  beforeEach(() => {
    spies.forEach((spy) => spy.mockClear());
  });

  it("Cycling through the annotation tools should trigger a deselection of the previous tool.", () => {
    let newState = initialState;
    const saga = watchToolDeselection();
    saga.next();
    saga.next(newState.uiInformation.activeTool);

    const cycleTool = () => {
      const action = cycleToolAction();
      newState = UiReducer(newState, action);
      saga.next(action);
      saga.next(newState);
    };

    cycleTool();

    expect(MoveToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(SkeletonToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(DrawToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(EraseToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(DrawToolController.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool();
    expect(EraseToolController.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool();
    expect(FillCellToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(PickCellToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(QuickSelectToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(BoundingBoxToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(ProofreadToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(LineMeasurementToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(AreaMeasurementToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(MoveToolController.onToolDeselected).toHaveBeenCalledTimes(2);
  });

  it("Selecting another tool should trigger a deselection of the previous tool.", () => {
    let newState = initialState;
    const saga = watchToolDeselection();
    saga.next();
    saga.next(wkReadyAction());
    saga.next(newState.uiInformation.activeTool);

    const cycleTool = (nextTool: AnnotationTool) => {
      const action = setToolAction(nextTool);
      newState = UiReducer(newState, action);
      saga.next(action);
      saga.next(newState);
    };

    cycleTool(AnnotationTool.SKELETON);
    expect(MoveToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.BRUSH);
    expect(SkeletonToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.ERASE_BRUSH);
    expect(DrawToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.TRACE);
    expect(EraseToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.ERASE_TRACE);
    expect(DrawToolController.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool(AnnotationTool.FILL_CELL);
    expect(EraseToolController.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool(AnnotationTool.PICK_CELL);
    expect(FillCellToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.BOUNDING_BOX);
    expect(PickCellToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.PROOFREAD);
    expect(BoundingBoxToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.LINE_MEASUREMENT);
    expect(ProofreadToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.AREA_MEASUREMENT);
    expect(LineMeasurementToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.MOVE);
    expect(AreaMeasurementToolController.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationTool.SKELETON);
    expect(MoveToolController.onToolDeselected).toHaveBeenCalledTimes(2);
  });
});

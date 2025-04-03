import { describe, it, beforeEach, expect, vi } from "vitest";
import { AnnotationToolEnum, type AnnotationTool } from "oxalis/constants";
import { initialState } from "test/fixtures/volumetracing_object";

const disabledInfoMock: { [key in any]?: any } = {};
Object.values(AnnotationToolEnum).forEach((annotationTool) => {
  disabledInfoMock[annotationTool] = {
    isDisabled: false,
    explanation: "",
  };
});

vi.mock("oxalis/model/accessors/tool_accessor", () => ({
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
  MoveTool,
  SkeletonTool,
  BoundingBoxTool,
  DrawTool,
  EraseTool,
  FillCellTool,
  PickCellTool,
  QuickSelectTool,
  ProofreadTool,
  LineMeasurementTool,
  AreaMeasurementTool,
} from "oxalis/controller/combinations/tool_controls";
import UiReducer from "oxalis/model/reducers/ui_reducer";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { cycleToolAction, setToolAction } from "oxalis/model/actions/ui_actions";
import { watchToolDeselection } from "oxalis/model/sagas/annotation_tool_saga";

describe("Annotation Tool Saga", () => {
  const allTools = [
    MoveTool,
    SkeletonTool,
    BoundingBoxTool,
    DrawTool,
    EraseTool,
    FillCellTool,
    PickCellTool,
    QuickSelectTool,
    ProofreadTool,
    LineMeasurementTool,
    AreaMeasurementTool,
  ];

  const spies = allTools.map((tool) => vi.spyOn(tool, "onToolDeselected"));

  beforeEach(() => {
    spies.forEach((spy) => spy.mockClear());
  });

  it("Cycling through the annotation tools should trigger a deselection of the previous tool.", () => {
    let newState = initialState;
    const saga = watchToolDeselection();
    saga.next();
    saga.next(wkReadyAction());
    saga.next(newState.uiInformation.activeTool);

    const cycleTool = () => {
      const action = cycleToolAction();
      newState = UiReducer(newState, action);
      saga.next(action);
      saga.next(newState);
    };

    cycleTool();
    expect(MoveTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(SkeletonTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(DrawTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(EraseTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(DrawTool.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool();
    expect(EraseTool.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool();
    expect(FillCellTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(PickCellTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(QuickSelectTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(BoundingBoxTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(ProofreadTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(LineMeasurementTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(AreaMeasurementTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool();
    expect(MoveTool.onToolDeselected).toHaveBeenCalledTimes(2);
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

    cycleTool(AnnotationToolEnum.SKELETON);
    expect(MoveTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.BRUSH);
    expect(SkeletonTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.ERASE_BRUSH);
    expect(DrawTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.TRACE);
    expect(EraseTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.ERASE_TRACE);
    expect(DrawTool.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool(AnnotationToolEnum.FILL_CELL);
    expect(EraseTool.onToolDeselected).toHaveBeenCalledTimes(2);
    cycleTool(AnnotationToolEnum.PICK_CELL);
    expect(FillCellTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.BOUNDING_BOX);
    expect(PickCellTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.PROOFREAD);
    expect(BoundingBoxTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.LINE_MEASUREMENT);
    expect(ProofreadTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.AREA_MEASUREMENT);
    expect(LineMeasurementTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.MOVE);
    expect(AreaMeasurementTool.onToolDeselected).toHaveBeenCalledTimes(1);
    cycleTool(AnnotationToolEnum.SKELETON);
    expect(MoveTool.onToolDeselected).toHaveBeenCalledTimes(2);
  });
});

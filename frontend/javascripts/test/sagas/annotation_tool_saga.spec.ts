import "test/mocks/lz4";
import test from "ava";
import _ from "lodash";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import mockRequire from "mock-require";
import { initialState } from "test/fixtures/volumetracing_object";
import sinon from "sinon";
const disabledInfoMock: { [key in any]?: any } = {};
Object.values(AnnotationTool).forEach((annotationTool) => {
  disabledInfoMock[annotationTool.id] = {
    isDisabled: false,
    explanation: "",
  };
});
mockRequire("oxalis/model/accessors/tool_accessor", {
  getDisabledInfoForTools: () => disabledInfoMock,
});
mockRequire("oxalis/controller/scene_controller_provider", () => ({
  lineMeasurementGeometry: {
    hide: _.noop,
    reset: _.noop,
    resetAndHide: _.noop,
  },
  areaMeasurementGeometry: {
    hide: _.noop,
    reset: _.noop,
    resetAndHide: _.noop,
  },
}));
const {
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
} = mockRequire.reRequire("oxalis/controller/combinations/tool_controls");
const UiReducer = mockRequire.reRequire("oxalis/model/reducers/ui_reducer").default;
const { wkReadyAction } = mockRequire.reRequire("oxalis/model/actions/actions");
const { cycleToolAction, setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");
const { watchToolDeselection } = mockRequire.reRequire("oxalis/model/sagas/annotation_tool_saga");
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
const spies = allTools.map((tool) => sinon.spy(tool, "onToolDeselected"));
test.beforeEach(() => {
  spies.forEach((spy) => spy.resetHistory());
});
test.serial(
  "Cycling through the annotation tools should trigger a deselection of the previous tool.",
  (t) => {
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
    t.true(MoveTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(SkeletonTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(DrawTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(EraseTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(DrawTool.onToolDeselected.calledTwice);
    cycleTool();
    t.true(EraseTool.onToolDeselected.calledTwice);
    cycleTool();
    t.true(FillCellTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(PickCellTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(QuickSelectTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(BoundingBoxTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(ProofreadTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(LineMeasurementTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(AreaMeasurementTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(MoveTool.onToolDeselected.calledTwice);
  },
);
test.serial("Selecting another tool should trigger a deselection of the previous tool.", (t) => {
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
  t.true(MoveTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.BRUSH);
  t.true(SkeletonTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.ERASE_BRUSH);
  t.true(DrawTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.TRACE);
  t.true(EraseTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.ERASE_TRACE);
  t.true(DrawTool.onToolDeselected.calledTwice);
  cycleTool(AnnotationTool.FILL_CELL);
  t.true(EraseTool.onToolDeselected.calledTwice);
  cycleTool(AnnotationTool.PICK_CELL);
  t.true(FillCellTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.BOUNDING_BOX);
  t.true(PickCellTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.PROOFREAD);
  t.true(BoundingBoxTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.LINE_MEASUREMENT);
  t.true(ProofreadTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.AREA_MEASUREMENT);
  t.true(LineMeasurementTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.MOVE);
  t.true(AreaMeasurementTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.SKELETON);
  t.true(MoveTool.onToolDeselected.calledTwice);
});

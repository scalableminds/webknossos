import "test/mocks/lz4";
import test from "ava";
import _ from "lodash";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import mockRequire from "mock-require";
import { initialState } from "test/fixtures/volumetracing_object";
import sinon from "sinon";
const disabledInfoMock: { [key in any]?: any } = {};
//

// todop: remove again
console.log("AnnotationTool", AnnotationTool.TRACE);

Object.values(AnnotationTool).forEach((annotationTool) => {
  disabledInfoMock[annotationTool.id] = {
    isDisabled: false,
    explanation: "",
  };
});
mockRequire("oxalis/model/accessors/disabled_tool_accessor", {
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
} = mockRequire.reRequire("oxalis/controller/combinations/tool_controls");
const UiReducer = mockRequire.reRequire("oxalis/model/reducers/ui_reducer").default;
const { cycleToolAction, setToolAction } = mockRequire.reRequire("oxalis/model/actions/ui_actions");
const { watchToolDeselection } = mockRequire.reRequire("oxalis/model/sagas/annotation_tool_saga");
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
const spies = allToolControllers.map((tool) => sinon.spy(tool, "onToolDeselected"));
test.beforeEach(() => {
  spies.forEach((spy) => spy.resetHistory());
});

// Todo: This test is currently skipped because mocking getDisabledInfoForTools does not work for
// some reason (other imports happen too early?). Hopefully, it is easier to fix with vitest.
test.serial.skip(
  "Cycling through the annotation tools should trigger a deselection of the previous tool.",
  (t) => {
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
    t.true(MoveToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(SkeletonToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(DrawToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(EraseToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(DrawToolController.onToolDeselected.calledTwice);
    cycleTool();
    t.true(EraseToolController.onToolDeselected.calledTwice);
    cycleTool();
    t.true(FillCellToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(PickCellToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(QuickSelectToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(BoundingBoxToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(ProofreadToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(LineMeasurementToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(AreaMeasurementToolController.onToolDeselected.calledOnce);
    cycleTool();
    t.true(MoveToolController.onToolDeselected.calledTwice);
  },
);
test.serial("Selecting another tool should trigger a deselection of the previous tool.", (t) => {
  let newState = initialState;
  const saga = watchToolDeselection();
  saga.next();
  saga.next(newState.uiInformation.activeTool);

  const cycleTool = (nextTool: AnnotationTool) => {
    const action = setToolAction(nextTool);
    newState = UiReducer(newState, action);
    saga.next(action);
    saga.next(newState);
  };

  cycleTool(AnnotationTool.SKELETON);
  t.true(MoveToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.BRUSH);
  t.true(SkeletonToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.ERASE_BRUSH);
  t.true(DrawToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.TRACE);
  t.true(EraseToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.ERASE_TRACE);
  t.true(DrawToolController.onToolDeselected.calledTwice);
  cycleTool(AnnotationTool.FILL_CELL);
  t.true(EraseToolController.onToolDeselected.calledTwice);
  cycleTool(AnnotationTool.PICK_CELL);
  t.true(FillCellToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.BOUNDING_BOX);
  t.true(PickCellToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.PROOFREAD);
  t.true(BoundingBoxToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.LINE_MEASUREMENT);
  t.true(ProofreadToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.AREA_MEASUREMENT);
  t.true(LineMeasurementToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.MOVE);
  t.true(AreaMeasurementToolController.onToolDeselected.calledOnce);
  cycleTool(AnnotationTool.SKELETON);
  t.true(MoveToolController.onToolDeselected.calledTwice);
});

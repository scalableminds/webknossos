// @flow

import test from "ava";
import { AnnotationToolEnum } from "oxalis/constants";

import mockRequire from "mock-require";
import { initialState } from "test/fixtures/volumetracing_object";
import sinon from "sinon";

const disabledInfoMock: { [any]: any } = {};
Object.values(AnnotationToolEnum).forEach(annotationTool => {
  disabledInfoMock[annotationTool] = { isDisabled: false, explanation: "" };
});
mockRequire("oxalis/model/accessors/tool_accessor", {
  getDisabledInfoForTools: () => disabledInfoMock,
});
const {
  MoveTool,
  SkeletonTool,
  BoundingBoxTool,
  DrawTool,
  EraseTool,
  FillCellTool,
  PickCellTool,
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
];

const spies = allTools.map(tool => sinon.spy(tool, "onToolDeselected"));
test.beforeEach(() => {
  spies.forEach(spy => spy.resetHistory());
});

test.serial(
  "Cycling through the annotation tools should trigger a deselection of the previous tool.",
  t => {
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
    t.true(BoundingBoxTool.onToolDeselected.calledOnce);
    cycleTool();
    t.true(MoveTool.onToolDeselected.calledTwice);
  },
);

test.serial("Selecting another tool should trigger a deselection of the previous tool.", t => {
  let newState = initialState;
  const saga = watchToolDeselection();
  saga.next();
  saga.next(wkReadyAction());
  saga.next(newState.uiInformation.activeTool);
  const cycleTool = nextTool => {
    const action = setToolAction(nextTool);
    newState = UiReducer(newState, action);
    saga.next(action);
    saga.next(newState);
  };

  cycleTool(AnnotationToolEnum.SKELETON);
  t.true(MoveTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.BRUSH);
  t.true(SkeletonTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.ERASE_BRUSH);
  t.true(DrawTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.TRACE);
  t.true(EraseTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.ERASE_TRACE);
  t.true(DrawTool.onToolDeselected.calledTwice);
  cycleTool(AnnotationToolEnum.FILL_CELL);
  t.true(EraseTool.onToolDeselected.calledTwice);
  cycleTool(AnnotationToolEnum.PICK_CELL);
  t.true(FillCellTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.BOUNDING_BOX);
  t.true(PickCellTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.MOVE);
  t.true(BoundingBoxTool.onToolDeselected.calledOnce);
  cycleTool(AnnotationToolEnum.SKELETON);
  t.true(MoveTool.onToolDeselected.calledTwice);
});

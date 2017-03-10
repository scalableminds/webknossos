import { saveSkeletonTracingAsync } from "oxalis/model/sagas/skeletontracing_saga";
import * as SkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import SkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { take, put } from "redux-saga/effects";

function expectValue(block) {
  expect(block.done).toBe(false);
  return expect(block.value);
}

function execCall(block) {
  expect(block.done).toBe(false);
  expect(block.value.CALL).not.toBeUndefined();
  return block.value.CALL.fn.apply(block.value.CALL.context, block.value.CALL.args);
}

function testDiffing(prevTracing, nextTracing) {
  let saga = saveSkeletonTracingAsync();
  expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
  saga.next();
  saga.next(prevTracing);
  saga.next();
  saga = execCall(saga.next(nextTracing));
  return Array.from(execCall(saga.next()));
}

describe("SkeletonTracingSaga", () => {
  const initialState = {
    task: {
      id: 1,
    },
    skeletonTracing: {
      trees: {
        "0": {
          treeId: 0,
          name: "TestTree",
          nodes: {},
          timestamp: 12345678,
          branchPoints: [],
          edges: [],
          comments: [],
          color: [23, 23, 23],
        },
      },
      tracingType: "Explorational",
      name: "",
      activeTreeId: 0,
      activeNodeId: null,
      restrictions: {
        branchPointsAllowed: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
      },
    },
  };
  const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction([1, 2, 3], [0, 1, 0], 0, 1.2));
  const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());
  const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction(), 12345678);
  const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());
  const setActiveNodeRadiusAction = addTimestamp(SkeletonTracingActions.setActiveNodeRadiusAction(12));
  const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction("Hallo"));
  const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction(), 12345678);

  it("should create a tree if there is none", () => {
    const saga = saveSkeletonTracingAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    saga.next({ skeletonTracing: { trees: {} } });
    expectValue(saga.next(true)).toEqual(put(SkeletonTracingActions.createTreeAction()));
  });

  it("shouldn't do anything if unchanged", () => {
    const saga = saveSkeletonTracingAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    saga.next(initialState.skeletonTracing);
    saga.next();
    expect(execCall(saga.next(initialState.skeletonTracing)).next().done).toBe(true);
  });

  it("should emit createNode update actions", () => {
    const newState = SkeletonTracingReducer(initialState, createNodeAction);

    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing);
    expect(updateActions[0].action).toBe("createNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit createNode and createEdge update actions", () => {
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("createNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.treeId).toBe(0);
    expect(updateActions[1].action).toBe("createNode");
    expect(updateActions[1].value.id).toBe(1);
    expect(updateActions[0].value.treeId).toBe(0);
    expect(updateActions[2].action).toBe("createEdge");
    expect(updateActions[2].value.treeId).toBe(0);
    expect(updateActions[2].value.source).toBe(0);
    expect(updateActions[2].value.target).toBe(1);
  });

  it("should emit createNode and createTree update actions", () => {
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("createTree");
    expect(updateActions[0].value.id).toBe(1);
    expect(updateActions[1].action).toBe("createNode");
    expect(updateActions[1].value.id).toBe(1);
    expect(updateActions[1].value.treeId).toBe(1);
    expect(updateActions[2].action).toBe("createNode");
    expect(updateActions[2].value.id).toBe(0);
    expect(updateActions[2].value.treeId).toBe(0);
  });


  it("should emit first deleteNode and then createNode update actions", () => {
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(1, 0));

    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createTreeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, mergeTreesAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("deleteNode");
    expect(updateActions[0].value.id).toBe(1);
    expect(updateActions[0].value.treeId).toBe(1);
    expect(updateActions[1].action).toBe("deleteTree");
    expect(updateActions[1].value.id).toBe(1);
    expect(updateActions[2].action).toBe("createNode");
    expect(updateActions[2].value.id).toBe(1);
    expect(updateActions[2].value.treeId).toBe(0);
    expect(updateActions[3].action).toBe("createEdge");
    expect(updateActions[3].value.treeId).toBe(0);
    expect(updateActions[3].value.source).toBe(1);
    expect(updateActions[3].value.target).toBe(0);
  });

  it("should emit a deleteNode update action", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("deleteNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit a deleteEdge update action", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("deleteNode");
    expect(updateActions[0].value.id).toBe(1);
    expect(updateActions[0].value.treeId).toBe(0);
    expect(updateActions[1].action).toBe("deleteEdge");
    expect(updateActions[1].value.treeId).toBe(0);
    expect(updateActions[1].value.source).toBe(0);
    expect(updateActions[1].value.target).toBe(1);
  });

  it("should emit a deleteTree update action", () => {
    const testState = SkeletonTracingReducer(initialState, createTreeAction);
    const newState = SkeletonTracingReducer(testState, deleteTreeAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("deleteTree");
    expect(updateActions[0].value.treeId).toBe(1);
  });

  it("should emit an updateNode update action", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("updateNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.radius).toBe(12);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit an updateNode update action", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (comments)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("updateTree");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.comments).toEqual([{ node: 0, comment: "Hallo" }]);
  });

  it("shouldn't emit an updateTree update actions (comments)", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createCommentAction);
    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (branchpoints)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createBranchPointAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing);

    expect(updateActions[0].action).toBe("updateTree");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.branchPoints).toEqual([{ id: 0, timestamp: 12345678 }]);
  });
});

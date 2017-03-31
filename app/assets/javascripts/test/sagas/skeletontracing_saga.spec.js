import mockRequire from "mock-require";
import _ from "lodash";

const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};

mockRequire("keyboardjs", KeyboardJS);
mockRequire("libs/window", { alert: console.log.bind(console) });
mockRequire("bootstrap-toggle", {});
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });

const { saveSkeletonTracingAsync, diffTracing } = mockRequire.reRequire("oxalis/model/sagas/skeletontracing_saga");
const SkeletonTracingActions = mockRequire.reRequire("oxalis/model/actions/skeletontracing_actions");
const { pushSaveQueueAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SkeletonTracingReducer = mockRequire.reRequire("oxalis/model/reducers/skeletontracing_reducer").default;
const { addTimestamp } = mockRequire.reRequire("oxalis/model/helpers/timestamp_middleware");
const { take, put } = mockRequire.reRequire("redux-saga/effects");
const { M4x4 } = mockRequire.reRequire("libs/mjs");
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

function expectValue(block) {
  expect(block.done).toBe(false);
  return expect(block.value);
}

function execCall(block) {
  expect(block.done).toBe(false);
  expect(block.value.CALL).not.toBeUndefined();
  return block.value.CALL.fn.apply(block.value.CALL.context, block.value.CALL.args);
}

function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter(item => item.action !== "updateTracing");
}

function testDiffing(prevTracing, nextTracing, flycam) {
  return withoutUpdateTracing(Array.from(diffTracing(prevTracing, nextTracing, flycam)));
}

describe("SkeletonTracingSaga", () => {
  const initialState = {
    dataset: {
      scale: [5, 5, 5],
    },
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
    flycam: {
      zoomStep: 2,
      currentMatrix: M4x4.identity,
      spaceDirectionOrtho: [1, 1, 1],
    },
  };
  const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction([1, 2, 3], [0, 1, 0], 0, 1.2));
  const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());
  const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction(), 12345678);
  const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());
  const setActiveNodeRadiusAction = addTimestamp(SkeletonTracingActions.setActiveNodeRadiusAction(12));
  const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction("Hallo"));
  const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction(), 12345678);

  it("should create a tree if there is none (saga test)", () => {
    const saga = saveSkeletonTracingAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    saga.next({ skeletonTracing: { trees: {} } });
    expectValue(saga.next(true)).toEqual(put(SkeletonTracingActions.createTreeAction()));
  });

  it("shouldn't do anything if unchanged (saga test)", () => {
    const saga = saveSkeletonTracingAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    saga.next(initialState.skeletonTracing);
    saga.next(false);
    saga.next();
    saga.next();
    saga.next(initialState.skeletonTracing);
    // only updateTracing
    const items = execCall(saga.next(initialState.flycam));
    expect(withoutUpdateTracing(items).length).toBe(0);
  });

  it("should do something if changed (saga test)", () => {
    const newState = SkeletonTracingReducer(initialState, createNodeAction);

    const saga = saveSkeletonTracingAsync();
    expectValue(saga.next()).toEqual(take("INITIALIZE_SKELETONTRACING"));
    saga.next();
    saga.next(initialState.skeletonTracing);
    saga.next(false);
    saga.next();
    saga.next();
    saga.next(newState.skeletonTracing);
    const items = execCall(saga.next(newState.flycam));
    expect(withoutUpdateTracing(items).length).toBeGreaterThan(0);
    expectValue(saga.next(items)).toEqual(put(pushSaveQueueAction(items)));
  });

  it("should emit createNode update actions", () => {
    const newState = SkeletonTracingReducer(initialState, createNodeAction);

    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing, newState.flycam);
    expect(updateActions[0].action).toBe("createNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit createNode and createEdge update actions", () => {
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing, newState.flycam);

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
    const updateActions = testDiffing(initialState.skeletonTracing, newState.skeletonTracing, newState.flycam);

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
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

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
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("deleteNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit a deleteEdge update action", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

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
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("deleteTree");
    expect(updateActions[0].value.id).toBe(1);
  });

  it("should emit an updateNode update action", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("updateNode");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.radius).toBe(12);
    expect(updateActions[0].value.treeId).toBe(0);
  });

  it("should emit an updateNode update action", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (comments)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("updateTree");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.comments).toEqual([{ node: 0, content: "Hallo" }]);
  });

  it("shouldn't emit an updateTree update actions (comments)", () => {
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createCommentAction);
    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (branchpoints)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createBranchPointAction);
    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("updateTree");
    expect(updateActions[0].value.id).toBe(0);
    expect(updateActions[0].value.branchPoints).toEqual([{ id: 0, timestamp: 12345678 }]);
  });

  it("should emit update actions on merge tree", () => {
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(0, 2));

    // create a node in first tree, then create a second tree with three nodes and merge them
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createTreeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, mergeTreesAction);

    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0]).toEqual({ action: "deleteNode", value: { treeId: 0, id: 0 } });
    expect(updateActions[1]).toEqual({ action: "deleteTree", value: { id: 0 } });
    expect(updateActions[2].action).toBe("createNode");
    expect(updateActions[2].value.id).toBe(0);
    expect(updateActions[2].value.treeId).toBe(1);
    expect(updateActions[3]).toEqual({
      action: "createEdge",
      value: { treeId: 1, source: 0, target: 2 },
    });
  });

  it("should emit update actions on split tree", () => {
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(0, 2));

    // create a node in first tree, then create a second tree with three nodes and merge them
    let testState = SkeletonTracingReducer(initialState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createTreeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    testState = SkeletonTracingReducer(testState, createNodeAction);
    testState = SkeletonTracingReducer(testState, mergeTreesAction);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);

    const updateActions = testDiffing(testState.skeletonTracing, newState.skeletonTracing, newState.flycam);

    expect(updateActions[0].action).toBe("createTree");
    expect(updateActions[0].value.id).toBe(2);
    expect(updateActions[1].action).toBe("createNode");
    expect(updateActions[1].value.id).toBe(3);
    expect(updateActions[1].value.treeId).toBe(2);
    expect(updateActions[2].action).toBe("createTree");
    expect(updateActions[2].value.id).toBe(3);
    expect(updateActions[3].action).toBe("createNode");
    expect(updateActions[3].value.id).toBe(0);
    expect(updateActions[3].value.treeId).toBe(3);
    expect(updateActions[4]).toEqual({ action: "deleteNode", value: { treeId: 1, id: 0 } });
    expect(updateActions[5]).toEqual({ action: "deleteNode", value: { treeId: 1, id: 2 } });
    expect(updateActions[6]).toEqual({ action: "deleteNode", value: { treeId: 1, id: 3 } });
    expect(updateActions[7]).toEqual({
      action: "deleteEdge",
      value: { treeId: 1, source: 1, target: 2 },
    });
    expect(updateActions[8]).toEqual({
      action: "deleteEdge",
      value: { treeId: 1, source: 2, target: 3 },
    });
    expect(updateActions[9]).toEqual({
      action: "deleteEdge",
      value: { treeId: 1, source: 0, target: 2 },
    });
    expect(updateActions[10].action).toBe("updateTree");
    expect(updateActions[10].value.id).toBe(1);
  });
});

/* eslint-disable import/no-extraneous-dependencies, import/first */
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import mockRequire from "mock-require";
import ChainReducer from "test/helpers/chainReducer";

const TIMESTAMP = 1494347146379;

const DateMock = {
  now: () => TIMESTAMP,
};

mockRequire("libs/window", { alert: console.log.bind(console) });
mockRequire("bootstrap-toggle", {});
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});

const { diffSkeletonTracing } = mockRequire.reRequire("oxalis/model/sagas/skeletontracing_saga");
const { saveTracingAsync, compactUpdateActions } = mockRequire.reRequire(
  "oxalis/model/sagas/save_saga",
);
const SkeletonTracingActions = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);
const { pushSaveQueueAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SkeletonTracingReducer = mockRequire.reRequire(
  "oxalis/model/reducers/skeletontracing_reducer",
).default;
const { take, put, race } = mockRequire.reRequire("redux-saga/effects");
const { M4x4 } = mockRequire.reRequire("libs/mjs");
import type { UpdateAction } from "oxalis/model/sagas/update_actions";

function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter(item => item.action !== "updateTracing");
}

function testDiffing(prevTracing, nextTracing, flycam) {
  return withoutUpdateTracing(Array.from(diffSkeletonTracing(prevTracing, nextTracing, flycam)));
}

const initialState = {
  dataset: {
    scale: [5, 5, 5],
  },
  task: {
    id: 1,
  },
  datasetConfiguration: {
    fourBit: false,
    interpolation: false,
  },
  tracing: {
    type: "skeleton",
    trees: {
      "1": {
        treeId: 1,
        name: "TestTree",
        nodes: {},
        timestamp: 12345678,
        branchPoints: [],
        edges: [],
        comments: [],
        color: [23, 23, 23],
        isVisible: true,
      },
    },
    tracingType: "Explorational",
    name: "",
    activeTreeId: 1,
    activeNodeId: null,
    cachedMaxNodeId: 0,
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
const createNodeAction = SkeletonTracingActions.createNodeAction([1, 2, 3], [0, 1, 0], 0, 1.2);
const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
const createTreeAction = SkeletonTracingActions.createTreeAction(12345678);
const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();
const setNodeRadiusAction = SkeletonTracingActions.setNodeRadiusAction(12);
const createCommentAction = SkeletonTracingActions.createCommentAction("Hallo");
const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(
  undefined,
  undefined,
  12345678,
);

const INIT_RACE_ACTION_OBJECT = {
  initSkeleton: take("INITIALIZE_SKELETONTRACING"),
  initVolume: take("INITIALIZE_VOLUMETRACING"),
};

test("SkeletonTracingSaga should create a tree if there is none (saga test)", t => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initSkeleton: true });
  saga.next({ tracing: { trees: {} } });
  t.is(saga.next(true).value.PUT.action.type, "CREATE_TREE");
});

test("SkeletonTracingSaga shouldn't do anything if unchanged (saga test)", t => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initSkeleton: true });
  saga.next(initialState.tracing);
  saga.next(false);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(initialState.tracing);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.flycam));
  t.is(withoutUpdateTracing(items).length, 0);
});

test("SkeletonTracingSaga should do something if changed (saga test)", t => {
  const newState = SkeletonTracingReducer(initialState, createNodeAction);

  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initSkeleton: true });
  saga.next(initialState.tracing);
  saga.next(false);
  saga.next();
  saga.next(true);
  saga.next();
  saga.next(newState.tracing);
  const items = execCall(t, saga.next(newState.flycam));
  t.true(withoutUpdateTracing(items).length > 0);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueAction(items)));
});

test("SkeletonTracingSaga should emit createNode update actions", t => {
  const newState = SkeletonTracingReducer(initialState, createNodeAction);

  const updateActions = testDiffing(initialState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "createNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit createNode and createEdge update actions", t => {
  const newState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  const updateActions = testDiffing(initialState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "createNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.treeId, 1);
  t.is(updateActions[1].action, "createNode");
  t.is(updateActions[1].value.id, 2);
  t.is(updateActions[1].value.treeId, 1);
  t.is(updateActions[2].action, "createEdge");
  t.is(updateActions[2].value.treeId, 1);
  t.is(updateActions[2].value.source, 1);
  t.is(updateActions[2].value.target, 2);
});

test("SkeletonTracingSaga should emit createNode and createTree update actions", t => {
  const newState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  const updateActions = testDiffing(initialState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "createTree");
  t.is(updateActions[0].value.id, 2);
  t.is(updateActions[1].action, "createNode");
  t.is(updateActions[1].value.id, 2);
  t.is(updateActions[1].value.treeId, 2);
  t.is(updateActions[2].action, "createNode");
  t.is(updateActions[2].value.id, 1);
  t.is(updateActions[2].value.treeId, 1);
});

test("SkeletonTracingSaga should emit first deleteNode and then createNode update actions", t => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(2, 1);

  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);

  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "deleteNode");
  t.is(updateActions[0].value.id, 2);
  t.is(updateActions[0].value.treeId, 2);
  t.is(updateActions[1].action, "deleteTree");
  t.is(updateActions[1].value.id, 2);
  t.is(updateActions[2].action, "createNode");
  t.is(updateActions[2].value.id, 2);
  t.is(updateActions[2].value.treeId, 1);
  t.is(updateActions[3].action, "createEdge");
  t.is(updateActions[3].value.treeId, 1);
  t.is(updateActions[3].value.source, 2);
  t.is(updateActions[3].value.target, 1);
});

test("SkeletonTracingSaga should emit a deleteNode update action", t => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "deleteNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit a deleteEdge update action", t => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "deleteNode");
  t.is(updateActions[0].value.id, 2);
  t.is(updateActions[0].value.treeId, 1);
  t.is(updateActions[1].action, "deleteEdge");
  t.is(updateActions[1].value.treeId, 1);
  t.is(updateActions[1].value.source, 1);
  t.is(updateActions[1].value.target, 2);
});

test("SkeletonTracingSaga should emit a deleteTree update action", t => {
  const testState = SkeletonTracingReducer(initialState, createTreeAction);
  const newState = SkeletonTracingReducer(testState, deleteTreeAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "deleteTree");
  t.is(updateActions[0].value.id, 2);
});

test("SkeletonTracingSaga should emit an updateNode update action", t => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.radius, 12);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit an updateNode update action", t => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setNodeRadiusAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.deepEqual(updateActions, []);
});

test("SkeletonTracingSaga should emit an updateTree update actions (comments)", t => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateTree");
  t.is(updateActions[0].value.id, 1);
  t.deepEqual(updateActions[0].value.comments, [{ node: 1, content: "Hallo" }]);
});

test("SkeletonTracingSaga shouldn't emit an updateTree update actions (comments)", t => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.deepEqual(updateActions, []);
});

test("SkeletonTracingSaga should emit an updateTree update actions (branchpoints)", t => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createBranchPointAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateTree");
  t.is(updateActions[0].value.id, 1);
  t.deepEqual(updateActions[0].value.branchPoints, [{ id: 1, timestamp: 12345678 }]);
});

test("SkeletonTracingSaga should emit update actions on merge tree", t => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 3);

  // create a node in first tree, then create a second tree with three nodes and merge them
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);

  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);
  t.deepEqual(updateActions[0], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { treeId: 1, id: 1 },
  });
  t.deepEqual(updateActions[1], { action: "deleteTree", timestamp: TIMESTAMP, value: { id: 1 } });
  t.is(updateActions[2].action, "createNode");
  t.is(updateActions[2].value.id, 1);
  t.is(updateActions[2].value.treeId, 2);
  t.deepEqual(updateActions[3], {
    action: "createEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 1, target: 3 },
  });
});

test("SkeletonTracingSaga should emit update actions on split tree", t => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 3);

  // create a node in first tree, then create a second tree with three nodes and merge them
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);

  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "createTree");
  t.is(updateActions[0].value.id, 3);
  t.is(updateActions[1].action, "createNode");
  t.is(updateActions[1].value.id, 4);
  t.is(updateActions[1].value.treeId, 3);
  t.is(updateActions[2].action, "createTree");
  t.is(updateActions[2].value.id, 4);
  t.is(updateActions[3].action, "createNode");
  t.is(updateActions[3].value.id, 1);
  t.is(updateActions[3].value.treeId, 4);
  t.deepEqual(updateActions[4], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { treeId: 2, id: 1 },
  });
  t.deepEqual(updateActions[5], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { treeId: 2, id: 3 },
  });
  t.deepEqual(updateActions[6], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { treeId: 2, id: 4 },
  });
  t.deepEqual(updateActions[7], {
    action: "deleteEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 2, target: 3 },
  });
  t.deepEqual(updateActions[8], {
    action: "deleteEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 3, target: 4 },
  });
  t.deepEqual(updateActions[9], {
    action: "deleteEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 1, target: 3 },
  });
  t.is(updateActions[10].action, "updateTree");
  t.is(updateActions[10].value.id, 2);
});

test("compactUpdateActions should detect a tree merge (1/3)", t => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 4);

  // Create three nodes in the first tree, then create a second tree with one node and merge them
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);

  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in a moved treeComponent of size three
  t.deepEqual(simplifiedUpdateActions[0], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 2, nodeIds: [1, 2, 3] },
  });
  // the deletion of the merged tree
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "deleteTree",
    timestamp: TIMESTAMP,
    value: { id: 1 },
  });
  // and a new edge to connect the two trees
  t.deepEqual(simplifiedUpdateActions[2], {
    action: "createEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 1, target: 4 },
  });
  t.is(simplifiedUpdateActions[3].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 4);
});

test("compactUpdateActions should detect a tree merge (2/3)", t => {
  // In this test multiple diffs are performed and concatenated before compactUpdateActions is invoked
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 5);

  // Create three nodes in the first tree, then create a second tree with one node
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Create another node (a)
  const newState1 = SkeletonTracingReducer(testState, createNodeAction);
  const updateActions = [];
  updateActions.push(testDiffing(testState.tracing, newState1.tracing, newState1.flycam));

  // Merge the two trees (b), then create another tree and node (c)
  const newState2 = ChainReducer(newState1)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  updateActions.push(testDiffing(newState1.tracing, newState2.tracing, newState2.flycam));

  // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in one created node and its edge (a)
  t.is(simplifiedUpdateActions[0].action, "createNode");
  t.is(simplifiedUpdateActions[0].value.id, 5);
  t.is(simplifiedUpdateActions[0].value.treeId, 2);
  t.is(simplifiedUpdateActions[1].action, "createEdge");
  t.is(simplifiedUpdateActions[1].value.treeId, 2);
  t.is(simplifiedUpdateActions[1].value.source, 4);
  t.is(simplifiedUpdateActions[1].value.target, 5);
  // a moved tree component of size three (b)
  t.deepEqual(simplifiedUpdateActions[2], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 2, nodeIds: [1, 2, 3] },
  });
  // the deletion of the merged tree (b)
  t.deepEqual(simplifiedUpdateActions[3], {
    action: "deleteTree",
    timestamp: TIMESTAMP,
    value: { id: 1 },
  });
  // the creation of a new tree and node (c)
  t.is(simplifiedUpdateActions[4].action, "createTree");
  t.is(simplifiedUpdateActions[5].action, "createNode");
  // a new edge to connect the two trees (b)
  t.deepEqual(simplifiedUpdateActions[6], {
    action: "createEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 2, source: 1, target: 5 },
  });
  t.is(simplifiedUpdateActions[7].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 8);
});

test("compactUpdateActions should detect a tree merge (3/3)", t => {
  // In this test multiple merges and diffs are performed and concatenated before compactUpdateActions is invoked
  const firstMergeTreesAction = SkeletonTracingActions.mergeTreesAction(4, 1);
  const secondMergeTreesAction = SkeletonTracingActions.mergeTreesAction(6, 1);

  // Create three nodes in the first tree, then create a second tree with one node
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Merge the second tree into the first tree (a)
  const stateAfterFirstMerge = SkeletonTracingReducer(testState, firstMergeTreesAction);
  const updateActions = [];
  updateActions.push(
    testDiffing(testState.tracing, stateAfterFirstMerge.tracing, stateAfterFirstMerge.flycam),
  );

  // Create another tree and two nodes (b)
  const newState = ChainReducer(stateAfterFirstMerge)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  updateActions.push(testDiffing(stateAfterFirstMerge.tracing, newState.tracing, newState.flycam));

  // Merge the second tree into the first tree again (c)
  const stateAfterSecondMerge = SkeletonTracingReducer(newState, secondMergeTreesAction);
  updateActions.push(
    testDiffing(newState.tracing, stateAfterSecondMerge.tracing, stateAfterSecondMerge.flycam),
  );

  // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in a moved treeComponent of size one (a)
  t.deepEqual(simplifiedUpdateActions[0], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 2, targetId: 1, nodeIds: [4] },
  });
  // the deletion of the first merged tree (a)
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "deleteTree",
    timestamp: TIMESTAMP,
    value: { id: 2 },
  });
  // the creation of an edge two connect the first two trees (a)
  t.deepEqual(simplifiedUpdateActions[2], {
    action: "createEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 1, source: 4, target: 1 },
  });
  t.is(simplifiedUpdateActions[3].action, "updateTree");
  // the creation of another tree, two nodes and one edge (b)
  t.is(simplifiedUpdateActions[4].action, "createTree");
  t.is(simplifiedUpdateActions[5].action, "createNode");
  t.is(simplifiedUpdateActions[6].action, "createNode");
  t.is(simplifiedUpdateActions[7].action, "createEdge");
  // a second merge (c)
  t.deepEqual(simplifiedUpdateActions[8], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 2, targetId: 1, nodeIds: [5, 6] },
  });
  t.deepEqual(simplifiedUpdateActions[9], {
    action: "deleteTree",
    timestamp: TIMESTAMP,
    value: { id: 2 },
  });
  t.deepEqual(simplifiedUpdateActions[10], {
    action: "createEdge",
    timestamp: TIMESTAMP,
    value: { treeId: 1, source: 6, target: 1 },
  });
  t.is(simplifiedUpdateActions[11].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 12);
});

test("compactUpdateActions should detect a tree split (1/3)", t => {
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);

  // Create four nodes
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete the second node to split the tree
  const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);

  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in a new tree
  t.is(simplifiedUpdateActions[0].action, "createTree");
  t.is(simplifiedUpdateActions[0].value.id, 2);
  // a treeComponent of size two that is moved to the new tree
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 2, nodeIds: [3, 4] },
  });
  // the deletion of the node and its two edges
  t.deepEqual(simplifiedUpdateActions[2], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 2, treeId: 1 },
  });
  t.is(simplifiedUpdateActions[3].action, "deleteEdge");
  t.is(simplifiedUpdateActions[4].action, "deleteEdge");
  t.is(simplifiedUpdateActions[5].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 6);
});

test("compactUpdateActions should detect a tree split (2/3)", t => {
  // Branchpoint tree split
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(2);

  // Create four nodes, then set node 2 as active and create another three nodes
  // Node 2 now has three neighbors
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setActiveNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete node 2 to split the tree into three parts
  const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);

  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in two new trees and two moved treeComponents of size three and two
  t.is(simplifiedUpdateActions[0].action, "createTree");
  t.is(simplifiedUpdateActions[0].value.id, 2);
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 2, nodeIds: [3, 4] },
  });
  t.is(simplifiedUpdateActions[2].action, "createTree");
  t.is(simplifiedUpdateActions[2].value.id, 3);
  t.deepEqual(simplifiedUpdateActions[3], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 3, nodeIds: [5, 6, 7] },
  });
  // the deletion of the node and its three edges
  t.deepEqual(simplifiedUpdateActions[4], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 2, treeId: 1 },
  });
  t.is(simplifiedUpdateActions[5].action, "deleteEdge");
  t.is(simplifiedUpdateActions[6].action, "deleteEdge");
  t.is(simplifiedUpdateActions[7].action, "deleteEdge");
  t.is(simplifiedUpdateActions[8].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 9);
});

test("compactUpdateActions should detect a tree split (3/3)", t => {
  // Detect multiple tree splits
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  const deleteOtherMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(4);

  // Create six nodes
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Delete the second node to split the tree (a)
  const newState1 = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
  const updateActions = [];
  updateActions.push(testDiffing(testState.tracing, newState1.tracing, newState1.flycam));

  // Delete node 4 to split the tree again (b)
  const newState2 = SkeletonTracingReducer(newState1, deleteOtherMiddleNodeAction);
  updateActions.push(testDiffing(newState1.tracing, newState2.tracing, newState2.flycam));

  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // This should result in the creation of a new tree (a)
  t.is(simplifiedUpdateActions[0].action, "createTree");
  t.is(simplifiedUpdateActions[0].value.id, 2);
  // a treeComponent of size four that is moved to the new tree (a)
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 1, targetId: 2, nodeIds: [3, 4, 5, 6] },
  });
  // and the deletion of the node and its two edges (a)
  t.deepEqual(simplifiedUpdateActions[2], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 2, treeId: 1 },
  });
  t.is(simplifiedUpdateActions[3].action, "deleteEdge");
  t.is(simplifiedUpdateActions[4].action, "deleteEdge");
  t.is(simplifiedUpdateActions[5].action, "updateTree");
  // the creation of a new tree (b)
  t.is(simplifiedUpdateActions[6].action, "createTree");
  t.is(simplifiedUpdateActions[6].value.id, 3);
  // a treeComponent of size two that is moved to the new tree (b)
  t.deepEqual(simplifiedUpdateActions[7], {
    action: "moveTreeComponent",
    timestamp: TIMESTAMP,
    value: { sourceId: 2, targetId: 3, nodeIds: [5, 6] },
  });
  // and the deletion of the node and its two edges (b)
  t.deepEqual(simplifiedUpdateActions[8], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 4, treeId: 2 },
  });
  t.is(simplifiedUpdateActions[9].action, "deleteEdge");
  t.is(simplifiedUpdateActions[10].action, "deleteEdge");
  t.is(simplifiedUpdateActions[11].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 12);
});

test("compactUpdateActions should do nothing if it cannot compact", t => {
  // The moveTreeComponent update action moves a list of nodeIds from and oldTreeId to a newTreeId
  // If the tree with the oldTreeId is deleted and the tree with the newTreeId is created
  // in the same diff, compactUpdateActions cannot insert the moveTreeComponent update action at
  // the right spot (see code comments for why)
  // This case cannot happen currently as there is no action in webknossos that results in such a diff,
  // it could however exist in the future and this test makes sure things won't break then
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 2);

  // Create three nodes in the first tree, then create a second tree with one node and merge them
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Create the tree that is merged to and merge the trees at the same time
  const newState = ChainReducer(testState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();

  // This will currently never be the result of one diff (see description of the test)
  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  // The deleteTree optimization in compactUpdateActions (that is unrelated to this test)
  // will remove the first deleteNode update action as the first tree is deleted because of the merge,
  // therefore remove it here as well
  updateActions[0].shift();

  // Nothing should be changed as the moveTreeComponent update action cannot be inserted
  t.deepEqual(simplifiedUpdateActions, updateActions[0]);
});

test("compactUpdateActions should detect a deleted tree", t => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Delete the tree
  const newState = ChainReducer(testState).apply(SkeletonTracingReducer, deleteTreeAction).unpack();

  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  t.deepEqual(simplifiedUpdateActions[0], {
    action: "deleteTree",
    timestamp: TIMESTAMP,
    value: { id: 2 },
  });
  t.is(simplifiedUpdateActions.length, 1);
});

test("compactUpdateActions should not detect a deleted tree if there is no deleted tree", t => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();

  // Delete almost all nodes from the tree
  const newState = ChainReducer(testState)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .unpack();

  const updateActions = [testDiffing(testState.tracing, newState.tracing, newState.flycam)];
  const simplifiedUpdateActions = compactUpdateActions(updateActions);

  t.deepEqual(simplifiedUpdateActions[0], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 2, treeId: 2 },
  });
  t.deepEqual(simplifiedUpdateActions[1], {
    action: "deleteNode",
    timestamp: TIMESTAMP,
    value: { id: 3, treeId: 2 },
  });
  t.is(simplifiedUpdateActions[2].action, "deleteEdge");
  t.is(simplifiedUpdateActions[3].action, "deleteEdge");
  t.is(simplifiedUpdateActions[4].action, "updateTree");
  t.is(simplifiedUpdateActions.length, 5);
});

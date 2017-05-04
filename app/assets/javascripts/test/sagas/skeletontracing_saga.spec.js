/* eslint-disable import/no-extraneous-dependencies, import/first */
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import mockRequire from "mock-require";
import _ from "lodash";
import ChainReducer from "test/helpers/chainReducer";

const KeyboardJS = {
  bind: _.noop,
  unbind: _.noop,
};

mockRequire("keyboardjs", KeyboardJS);
mockRequire("libs/window", { alert: console.log.bind(console) });
mockRequire("bootstrap-toggle", {});
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mockRequire("oxalis/model/sagas/root_saga", function* () { yield; });

const { diffSkeletonTracing } = mockRequire.reRequire("oxalis/model/sagas/skeletontracing_saga");
const { saveTracingAsync } = mockRequire.reRequire("oxalis/model/sagas/save_saga");
const SkeletonTracingActions = mockRequire.reRequire("oxalis/model/actions/skeletontracing_actions");
const { pushSaveQueueAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");
const SkeletonTracingReducer = mockRequire.reRequire("oxalis/model/reducers/skeletontracing_reducer").default;
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
const setActiveNodeRadiusAction = SkeletonTracingActions.setActiveNodeRadiusAction(12);
const createCommentAction = SkeletonTracingActions.createCommentAction("Hallo");
const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(undefined, undefined, 12345678);

const INIT_RACE_ACTION_OBJECT = {
  initSkeleton: take("INITIALIZE_SKELETONTRACING"),
  initVolume: take("INITIALIZE_VOLUMETRACING"),
};

test("SkeletonTracingSaga should create a tree if there is none (saga test)", (t) => {
  const saga = saveTracingAsync();
  expectValueDeepEqual(t, saga.next(), race(INIT_RACE_ACTION_OBJECT));
  saga.next({ initSkeleton: true });
  saga.next({ tracing: { trees: {} } });
  t.is(saga.next(true).value.PUT.action.type, "CREATE_TREE");
});

test("SkeletonTracingSaga shouldn't do anything if unchanged (saga test)", (t) => {
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

test("SkeletonTracingSaga should do something if changed (saga test)", (t) => {
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

test("SkeletonTracingSaga should emit createNode update actions", (t) => {
  const newState = SkeletonTracingReducer(initialState, createNodeAction);

  const updateActions = testDiffing(initialState.tracing, newState.tracing, newState.flycam);
  t.is(updateActions[0].action, "createNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit createNode and createEdge update actions", (t) => {
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

test("SkeletonTracingSaga should emit createNode and createTree update actions", (t) => {
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

test("SkeletonTracingSaga should emit first deleteNode and then createNode update actions", (t) => {
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

test("SkeletonTracingSaga should emit a deleteNode update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "deleteNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit a deleteEdge update action", (t) => {
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

test("SkeletonTracingSaga should emit a deleteTree update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createTreeAction);
  const newState = SkeletonTracingReducer(testState, deleteTreeAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "deleteTree");
  t.is(updateActions[0].value.id, 2);
});

test("SkeletonTracingSaga should emit an updateNode update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateNode");
  t.is(updateActions[0].value.id, 1);
  t.is(updateActions[0].value.radius, 12);
  t.is(updateActions[0].value.treeId, 1);
});

test("SkeletonTracingSaga should emit an updateNode update action", (t) => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setActiveNodeRadiusAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, setActiveNodeRadiusAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.deepEqual(updateActions, []);
});

test("SkeletonTracingSaga should emit an updateTree update actions (comments)", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateTree");
  t.is(updateActions[0].value.id, 1);
  t.deepEqual(updateActions[0].value.comments, [{ node: 1, content: "Hallo" }]);
});

test("SkeletonTracingSaga shouldn't emit an updateTree update actions (comments)", (t) => {
  const testState = ChainReducer(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.deepEqual(updateActions, []);
});

test("SkeletonTracingSaga should emit an updateTree update actions (branchpoints)", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createBranchPointAction);
  const updateActions = testDiffing(testState.tracing, newState.tracing, newState.flycam);

  t.is(updateActions[0].action, "updateTree");
  t.is(updateActions[0].value.id, 1);
  t.deepEqual(updateActions[0].value.branchPoints, [{ id: 1, timestamp: 12345678 }]);
});

test("SkeletonTracingSaga should emit update actions on merge tree", (t) => {
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
  t.deepEqual(updateActions[0], { action: "deleteNode", value: { treeId: 1, id: 1 } });
  t.deepEqual(updateActions[1], { action: "deleteTree", value: { id: 1 } });
  t.is(updateActions[2].action, "createNode");
  t.is(updateActions[2].value.id, 1);
  t.is(updateActions[2].value.treeId, 2);
  t.deepEqual(updateActions[3], {
    action: "createEdge",
    value: { treeId: 2, source: 1, target: 3 },
  });
});

test("SkeletonTracingSaga should emit update actions on split tree", (t) => {
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
  t.deepEqual(updateActions[4], { action: "deleteNode", value: { treeId: 2, id: 1 } });
  t.deepEqual(updateActions[5], { action: "deleteNode", value: { treeId: 2, id: 3 } });
  t.deepEqual(updateActions[6], { action: "deleteNode", value: { treeId: 2, id: 4 } });
  t.deepEqual(updateActions[7], { action: "deleteEdge", value: { treeId: 2, source: 2, target: 3 } });
  t.deepEqual(updateActions[8], { action: "deleteEdge", value: { treeId: 2, source: 3, target: 4 } });
  t.deepEqual(updateActions[9], { action: "deleteEdge", value: { treeId: 2, source: 1, target: 3 } });
  t.is(updateActions[10].action, "updateTree");
  t.is(updateActions[10].value.id, 2);
});

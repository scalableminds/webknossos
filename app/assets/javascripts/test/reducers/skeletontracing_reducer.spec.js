/**
 * skeletontracing_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from "ava";

import _ from "lodash";
import mock from "mock-require";
import * as SkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import update from "immutability-helper";

mock.stopAll();
mock("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mock("libs/window", { confirm: () => true });
const SkeletonTracingReducer = mock.reRequire("oxalis/model/reducers/skeletontracing_reducer").default;

function deepEqualObjectContaining(t: Object, actual: Object, expected: Object) {
  Object.keys(expected).forEach((key) => {
    t.deepEqual(actual[key], expected[key]);
  });
}

const initialState = {
  dataset: {
    scale: [5, 5, 5],
  },
  userConfiguration: null,
  datasetConfiguration: {
    fourBit: false,
    interpolation: false,
  },
  task: {
    id: 1,
  },
  skeletonTracing: {
    trees: {
      [0]: {
        treeId: 0,
        name: "TestTree",
        nodes: {},
        timestamp: Date.now(),
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
    cachedMaxNodeId: -1,
    restrictions: {
      branchPointsAllowed: true,
      allowUpdate: true,
      allowFinish: true,
      allowAccess: true,
      allowDownload: true,
    },
  },
};

const position = [10, 10, 10];
const rotation = [0.5, 0.5, 0.5];
const viewport = 0;
const resolution = 0;

test("SkeletonTracing should add a new node", (t) => {
  const action = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const newState = SkeletonTracingReducer(initialState, action);

  t.not(newState, initialState);

  // This should be unchanged / sanity check
  t.is(newState.skeletonTracing.name, initialState.skeletonTracing.name);
  t.is(newState.skeletonTracing.activeTreeId, initialState.skeletonTracing.activeTreeId);
  t.is(newState.skeletonTracing.trees[0].branchPoints, initialState.skeletonTracing.trees[0].branchPoints);
  t.is(newState.skeletonTracing.trees[0].treeId, initialState.skeletonTracing.trees[0].treeId);
  t.is(newState.skeletonTracing.trees[0].name, initialState.skeletonTracing.trees[0].name);

  // This should be changed
  const maxNodeId = _.max(Object.keys(newState.skeletonTracing.trees[0].nodes));

  t.is(maxNodeId, "0");
  t.is(newState.skeletonTracing.activeNodeId, 0);
  t.deepEqual(_.size(newState.skeletonTracing.trees[0].edges), 0);

  deepEqualObjectContaining(t, newState.skeletonTracing.trees[0].nodes[0], {
    position,
    rotation,
    viewport,
    resolution,
    id: 0,
    radius: 50,
  });
});

test("SkeletonTracing should add a several nodes", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);

  // create three nodes
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);

  t.not(newState, initialState);
  const maxNodeId = _.max(_.flatMap(newState.skeletonTracing.trees, tree => _.map(tree.nodes, node => node.id)));
  t.is(maxNodeId, 2);
  t.is(newState.skeletonTracing.activeNodeId, 2);
  t.deepEqual(_.size(newState.skeletonTracing.trees[0].nodes), 3);
  t.deepEqual(newState.skeletonTracing.trees[0].edges.length, 2);
  t.deepEqual(newState.skeletonTracing.trees[0].edges, [
    { source: 0, target: 1 },
    { source: 1, target: 2 },
  ]);
});

test("SkeletonTracing should add nodes to a different tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createTreeAction = SkeletonTracingActions.createTreeAction();

  // add a node to inital tree, then create a second tree and add two nodes
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);

  t.not(newState, initialState);
  const maxNodeId = _.max(_.flatMap(newState.skeletonTracing.trees, tree => _.map(tree.nodes, node => node.id)));
  t.is(maxNodeId, 2);
  t.is(newState.skeletonTracing.activeTreeId, 1);
  t.is(newState.skeletonTracing.activeNodeId, 2);
  t.deepEqual(_.size(newState.skeletonTracing.trees[0].nodes), 1);
  t.deepEqual(_.size(newState.skeletonTracing.trees[1].nodes), 2);
  t.deepEqual(newState.skeletonTracing.trees[0].edges.length, 0);
  t.deepEqual(newState.skeletonTracing.trees[1].edges, [
    { source: 1, target: 2 },
  ]);
});

test("SkeletonTracing shouldn't delete a node from an empty tree", (t) => {
  const action = SkeletonTracingActions.deleteNodeAction();
  const newState = SkeletonTracingReducer(initialState, action);

  t.is(newState, initialState);
  t.deepEqual(newState, initialState);
});

test("SkeletonTracing should delete a node from a tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

  // Add two nodes, then delete one
  const newState = SkeletonTracingReducer(initialState, createNodeAction);
  const newStateA = SkeletonTracingReducer(newState, createNodeAction);
  const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

  t.not(newStateB, newState);
  t.not(newStateB, newStateA);
  t.not(newStateA, newState);
  t.deepEqual(newStateB, newState);
});

test("SkeletonTracing should delete several nodes from a tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

  // Add one node, then delete two times
  const newState = SkeletonTracingReducer(initialState, createNodeAction);
  const newStateA = SkeletonTracingReducer(newState, deleteNodeAction);
  const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

  t.not(newStateB, newState);
  t.not(newStateA, newState);
  t.is(newStateB, newStateA);
  t.deepEqual(Object.keys(newStateB.skeletonTracing.trees[1].nodes).length, 0);
});

test("SkeletonTracing should delete nodes and split the tree", (t) => {
  const createDummyNode = id => ({
    bitDepth: 8,
    id,
    position: [0, 0, 0],
    radius: 10,
    resolution: 10,
    rotation: [0, 0, 0],
    timestamp: 0,
    viewport: 1,
  });

  const state = update(
    initialState,
    { skeletonTracing: { trees: { $set: {
      [0]: {
        treeId: 0,
        name: "TestTree-0",
        nodes: {
          [0]: createDummyNode(0),
          [1]: createDummyNode(1),
          [2]: createDummyNode(2),
          [7]: createDummyNode(7),
        },
        timestamp: Date.now(),
        branchPoints: [
          { id: 1, timestamp: 0 },
          { id: 7, timestamp: 0 },
        ],
        edges: [
          { source: 0, target: 1 },
          { source: 2, target: 1 },
          { source: 1, target: 7 },
        ],
        comments: [{ comment: "comment", node: 0 }],
        color: [23, 23, 23],
      },
      [1]: {
        treeId: 1,
        name: "TestTree-1",
        nodes: {
          [4]: createDummyNode(4),
          [5]: createDummyNode(5),
          [6]: createDummyNode(6),
        },
        timestamp: Date.now(),
        branchPoints: [],
        edges: [
          { source: 4, target: 5 },
          { source: 5, target: 6 },
        ],
        comments: [],
        color: [30, 30, 30],
      },
    } } } });


  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

  // Add three nodes node, then delete the second one
  const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
  const state1 = SkeletonTracingReducer(state0, deleteNodeAction);

  const newTrees = state1.skeletonTracing.trees;

  t.is(Object.keys(newTrees).length, 4);
  t.is(newTrees[0].nodes[0].id, 0);
  t.is(newTrees[0].comments.length, 1);
  t.is(newTrees[0].comments[0].node, 0);
  t.is(newTrees[1].nodes[4].id, 4);

  t.is(newTrees[2].nodes[2].id, 2);
  t.is(newTrees[3].nodes[7].id, 7);
  t.is(newTrees[3].branchPoints[0].id, 7);
});

test("SkeletonTracing should set a new active node", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(0);

  // Create two nodes, then set first one active
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveNodeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeNodeId, 0);
  t.is(newState.skeletonTracing.activeTreeId, 0);
});

test("SkeletonTracing should set a new active node in a different tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);

  // Create one node in the first tree, then set create second tree with two nodes
  // Then set first node of second tree active
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveNodeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeNodeId, 1);
  t.is(newState.skeletonTracing.activeTreeId, 1);
});

test("SkeletonTracing should set a new node radius", (t) => {
  const newRadius = 10;
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const setActiveNodeRadiusAction = SkeletonTracingActions.setActiveNodeRadiusAction(newRadius);

  // Create a node and change its readius
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveNodeRadiusAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].nodes[0].radius, newRadius);
});

test("SkeletonTracing should create a branchpoint", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create a single node and then set it as branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints.length, 1);
  deepEqualObjectContaining(t, newState.skeletonTracing.trees[0].branchPoints[0], {
    id: 0,
  });
});

test("SkeletonTracing shouldn't create a branchpoint in an empty tree", (t) => {
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create a branchpoint in a tree without any nodes
  const newState = SkeletonTracingReducer(initialState, createBranchPointAction);
  t.is(newState, initialState);
  t.is(newState, initialState);
});

test("SkeletonTracing shouldn't create a branchpoint without the correct permissions", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create a node and set a branch point in tracing without the correct permissions
  const startState = _.cloneDeep(initialState);
  startState.skeletonTracing.restrictions.branchPointsAllowed = false;

  let newState = SkeletonTracingReducer(startState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints.length, 0);
});

test("SkeletonTracing shouldn't create more branchpoints than nodes", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create one node and set it as branchpoint three times
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints.length, 1);
  deepEqualObjectContaining(t, newState.skeletonTracing.trees[0].branchPoints[0], {
    id: 0,
  });
});

test("SkeletonTracing should delete a branchpoint", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

  // create one node and set it as branchpoint, create a second node and jump back to branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.trees[0].branchPoints.length, 0);
  t.is(_.size(newState.skeletonTracing.trees[0].nodes), 2);
  t.is(newState.skeletonTracing.activeNodeId, 0);
  t.is(newState.skeletonTracing.activeTreeId, 0);
});

test("SkeletonTracing should delete several branchpoints", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

  // create two nodes and set them both as branchpoint
  // then delete them both and jump back to first node
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.trees[0].branchPoints.length, 0);
  t.is(_.size(newState.skeletonTracing.trees[0].nodes), 2);
  t.is(newState.skeletonTracing.activeNodeId, 0);
  t.is(newState.skeletonTracing.activeTreeId, 0);
});

test("SkeletonTracing shouldn't delete more branchpoints than available", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

  // create two nodes and set them both as branchpoint
  // then delete them both and jump back to first node
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.trees[0].branchPoints.length, 0);
  t.is(_.size(newState.skeletonTracing.trees[0].nodes), 1);
  t.is(newState.skeletonTracing.activeNodeId, 0);
  t.is(newState.skeletonTracing.activeTreeId, 0);
});

test("SkeletonTracing should delete a branchpoint from a different tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

  // create a new tree, add a node, set it as branchpoint twice then delete the branchpoint
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.trees[0].branchPoints.length, 0);
  t.is(newState.skeletonTracing.trees[1].branchPoints.length, 0);
});

test("SkeletonTracing should delete a branchpoint from another tree than the active one", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

  // create a new tree, add a node, set it as branchpoint
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  // create another tree, delete the original branchpoint
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.trees[0].branchPoints.length, 0);
  t.is(newState.skeletonTracing.trees[1].branchPoints.length, 0);
  // as the branchpoint was in the first tree, the first tree should be active again
  t.is(newState.skeletonTracing.activeTreeId, 1);
});

test("SkeletonTracing should add a new tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const newState = SkeletonTracingReducer(initialState, createTreeAction);

  t.not(newState, initialState);
  t.is(_.size(newState.skeletonTracing.trees), 2);
  t.is(newState.skeletonTracing.trees[1].treeId, 1);
  t.is(newState.skeletonTracing.activeTreeId, 1);
  t.is(newState.skeletonTracing.activeNodeId, null);
  deepEqualObjectContaining(t, newState.skeletonTracing.trees[1], {
    comments: [],
    branchPoints: [],
    nodes: {},
    treeId: 1,
    color: [0, 0.29179606750063036, 1],
    // name: ...
  });
});

test("SkeletonTracing should add a several new trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();

  // create three trees
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);

  t.not(newState, initialState);
  t.is(_.size(newState.skeletonTracing.trees), 4);
  t.is(_.max(_.map(newState.skeletonTracing.trees, "treeId")), 3);
  t.is(newState.skeletonTracing.activeTreeId, 3);
  t.is(newState.skeletonTracing.activeNodeId, null);
});

test("SkeletonTracing should delete a new tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();

  // create a tree and delete it again
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, deleteTreeAction);

  t.not(newState, initialState);
  t.deepEqual(newState, initialState);
});

test("SkeletonTracing should delete several trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();

  // create a tree and delete it three times
  // there should always be at least one tree in a tracing
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, deleteTreeAction);
  newState = SkeletonTracingReducer(newState, deleteTreeAction);
  newState = SkeletonTracingReducer(newState, deleteTreeAction);

  t.not(newState, initialState);
  t.deepEqual(_.size(newState.skeletonTracing.trees), 1);
  t.not(newState.skeletonTracing.trees, initialState.skeletonTracing.trees);
  t.is(Object.keys(newState.skeletonTracing.trees).length, 1);
});

test("SkeletonTracing should set a new active tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(1);
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, setActiveTreeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeTreeId, 1);
  t.is(newState.skeletonTracing.activeNodeId, null);
});

test("SkeletonTracing should set a different active tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(1);

  // create a second tree with two nodes and set it active
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveTreeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeTreeId, 1);
  t.is(newState.skeletonTracing.activeNodeId, 1);
});

test("SkeletonTracing shouldn't set a new active tree for unknown tree ids", (t) => {
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(10);
  const newState = SkeletonTracingReducer(initialState, setActiveTreeAction);

  t.is(newState, initialState);
});

test("SkeletonTracing should merge two trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(0, 2);

  // create a node in first tree, then create a second tree with three nodes and merge them
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, mergeTreesAction);

  t.not(newState, initialState);
  t.is(_.size(newState.skeletonTracing.trees), 1);
  t.is(_.size(newState.skeletonTracing.trees[1].nodes), 4);
  t.deepEqual(newState.skeletonTracing.trees[1].edges, [
    { source: 1, target: 2 },
    { source: 2, target: 3 },
    { source: 0, target: 2 },
  ]);
});

test("SkeletonTracing shouldn't merge the same tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(0, 2);

  // create a node in first tree, then create a second tree with three nodes and merge them
  let testState = SkeletonTracingReducer(initialState, createNodeAction);
  testState = SkeletonTracingReducer(testState, createNodeAction);
  testState = SkeletonTracingReducer(testState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);

  t.is(newState, testState);
});

test("SkeletonTracing should merge two trees with comments and branchPoints", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(0, 2);
  const createCommentAction = SkeletonTracingActions.createCommentAction("foo");
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create a node in first tree, then create a second tree with three nodes and merge them
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, mergeTreesAction);

  t.not(newState, initialState);
  t.is(_.size(newState.skeletonTracing.trees), 1);
  t.is(_.size(newState.skeletonTracing.trees[1].nodes), 4);
  t.deepEqual(newState.skeletonTracing.trees[1].edges, [
    { source: 1, target: 2 },
    { source: 2, target: 3 },
    { source: 0, target: 2 },
  ]);
  t.is(newState.skeletonTracing.trees[1].comments.length, 2);
  t.is(newState.skeletonTracing.trees[1].branchPoints.length, 1);
});

test("SkeletonTracing should rename the active tree", (t) => {
  const newName = "SuperTestName";
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName);
  const newState = SkeletonTracingReducer(initialState, setTreeNameAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].name, newName);
});

test("SkeletonTracing should rename the active tree to a default name", (t) => {
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction();
  const newState = SkeletonTracingReducer(initialState, setTreeNameAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].name, "Tree000");
});

test("SkeletonTracing should increase the activeTreeId", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(0);
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction();

  // create a second tree, set first tree active then increase activeTreeId
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, setActiveTreeAction);
  newState = SkeletonTracingReducer(newState, selectNextTreeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeTreeId, 1);
});

test("SkeletonTracing should decrease the activeTreeId", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction(false);

  // create a second tree then decrease activeTreeId
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, selectNextTreeAction);

  t.not(newState, initialState);
  t.is(newState.skeletonTracing.activeTreeId, 0);
});

test("SkeletonTracing should shuffle the color of a specified tree", (t) => {
  const shuffleTreeColorAction = SkeletonTracingActions.shuffleTreeColorAction(0);
  const newState = SkeletonTracingReducer(initialState, shuffleTreeColorAction);

  t.not(newState, initialState);
  t.notDeepEqual(newState.skeletonTracing.trees[0].color, [23, 23, 23]);
});

test("SkeletonTracing should create a comment for the active node", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);

  // create a single node with a comment
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 1);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].content, commentText);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].node, 0);
});

test("SkeletonTracing shouldn't create a comments if there is no active node", (t) => {
  const commentText = "Wow such test comment";
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const newState = SkeletonTracingReducer(initialState, createCommentAction);

  t.is(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 0);
});

test("SkeletonTracing shouldn't create more than one comment for the active node", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);

  // create a node and add the same comment three times
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 1);
});

test("SkeletonTracing should create comments for several nodes", (t) => {
  const commentText1 = "Wow such test comment";
  const commentText2 = "Amaze test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);

  // create two nodes with a different comment each
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, SkeletonTracingActions.createCommentAction(commentText1));
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, SkeletonTracingActions.createCommentAction(commentText2));

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 2);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].content, commentText1);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].node, 0);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[1].content, commentText2);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[1].node, 1);
});

test("SkeletonTracing should create comments for a different tree", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const createTreeAction = SkeletonTracingActions.createTreeAction();

  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 0);
  t.deepEqual(newState.skeletonTracing.trees[1].comments.length, 1);
});

test("SkeletonTracing should delete a comment for a node", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction();

  // create a node with a comment, then delete it
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, deleteCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 0);
});

test("SkeletonTracing should only delete the comment for the active node", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction();

  // create two nodes with a comment each and delete the comment for the last node
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, deleteCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 1);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].node, 0);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].content, commentText);
});

test("SkeletonTracing should add a node in a specified tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution, 1);

  // create a few trees and add a node to a specific one
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);

  t.not(newState, initialState);
  t.truthy(newState.skeletonTracing.trees[1].nodes[0]);
  t.is(newState.skeletonTracing.activeTreeId, 1);
  t.is(newState.skeletonTracing.activeNodeId, 0);
});

test("SkeletonTracing should delete a specified node (1/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(1, 0);

  // create three nodes and delete a specific one
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, deleteNodeAction);

  t.not(newState, initialState);
  t.falsy(newState.skeletonTracing.trees[0].nodes[1]);
  // tree is split
  t.truthy(newState.skeletonTracing.trees[1]);
  t.is(newState.skeletonTracing.activeNodeId, 2);
  t.is(newState.skeletonTracing.activeTreeId, 1);
});

test("SkeletonTracing should delete a specified node (2/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(1);

  // create three nodes and delete a specific one
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, deleteNodeAction);

  t.not(newState, initialState);
  t.falsy(newState.skeletonTracing.trees[0].nodes[1]);
  // tree is split
  t.truthy(newState.skeletonTracing.trees[1]);
  t.is(newState.skeletonTracing.activeNodeId, 2);
  t.is(newState.skeletonTracing.activeTreeId, 1);
});

test("SkeletonTracing should create a branchpoint for a specified node (1/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(1, 0);

  // create some nodes and then set a specific one as branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints.length, 1);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints[0].id, 1);
});

test("SkeletonTracing should create a branchpoint for a specified node (2/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(1);

  // create some nodes and then set a specific one as branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints.length, 1);
  t.deepEqual(newState.skeletonTracing.trees[0].branchPoints[0].id, 1);
});

test("SkeletonTracing should delete a specified tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction(1);

  // create some trees and delete a specific one
  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, deleteTreeAction);

  t.not(newState, initialState);
  t.falsy(newState.skeletonTracing.trees[1]);
  t.truthy(newState.skeletonTracing.trees[2]);
  t.is(newState.skeletonTracing.activeTreeId, 2);
});

test("SkeletonTracing should rename a specified tree", (t) => {
  const newName = "SuperTestName";
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName, 1);

  let newState = SkeletonTracingReducer(initialState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, setTreeNameAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[1].name, newName);
  t.notDeepEqual(newState.skeletonTracing.trees[0].name, newName);
  t.notDeepEqual(newState.skeletonTracing.trees[2].name, newName);
});

test("SkeletonTracing should create a comment for a specified node", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText, 1);

  // create a few nodes and adds one comment
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 1);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].content, commentText);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].node, 1);
});
test("SkeletonTracing should delete a comment for a specified node (1/2)", (t) => {
  const commentText = "Wow such test comment";

  const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction(1);

  // create nodes with comments, then delete a specific comment
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createCommentAction);
  newState = SkeletonTracingReducer(newState, deleteCommentAction);

  t.not(newState, initialState);
  t.deepEqual(newState.skeletonTracing.trees[0].comments.length, 2);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[0].node, 0);
  t.deepEqual(newState.skeletonTracing.trees[0].comments[1].node, 2);
});

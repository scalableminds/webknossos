/* eslint-disable no-useless-computed-key */
import "test/mocks/lz4";
import test from "ava";
import update from "immutability-helper";
import { rgbs as colors } from "libs/color_generator";
import DiffableMap from "libs/diffable_map";
import _ from "lodash";
import mock from "mock-require";
import { TreeTypeEnum, type Vector3 } from "oxalis/constants";
import defaultState from "oxalis/default_state";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import type { Action } from "oxalis/model/actions/actions";
import type * as OriginalSkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import EdgeCollection from "oxalis/model/edge_collection";
import type OriginalSkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import type { Node, OxalisState, SkeletonTracing } from "oxalis/store";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import ChainReducer from "test/helpers/chainReducer";

mock("app", {
  currentUser: {
    firstName: "SCM",
    lastName: "Boy",
  },
});
mock("libs/window", {
  confirm: () => true,
  document: {
    getElementById: () => null,
  },
});
const SkeletonTracingReducer: typeof OriginalSkeletonTracingReducer = mock.reRequire(
  "oxalis/model/reducers/skeletontracing_reducer",
).default;
const SkeletonTracingActions: typeof OriginalSkeletonTracingActions = mock.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);

function deepEqualObjectContaining(
  t: Record<string, any>,
  actual: Record<string, any>,
  expected: Record<string, any>,
) {
  Object.keys(expected).forEach((key) => {
    t.deepEqual(actual[key], expected[key]);
  });
}

const initialSkeletonTracing: SkeletonTracing = {
  type: "skeleton",
  createdTimestamp: 0,
  tracingId: "tracingId",
  version: 0,
  trees: {},
  treeGroups: [],
  activeGroupId: null,
  activeTreeId: 1,
  activeNodeId: null,
  cachedMaxNodeId: 0,
  boundingBox: null,
  userBoundingBoxes: [],
  navigationList: {
    list: [],
    activeIndex: -1,
  },
  showSkeletons: true,
  additionalAxes: [],
};
initialSkeletonTracing.trees[1] = {
  treeId: 1,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible: true,
  groupId: MISSING_GROUP_ID,
  type: TreeTypeEnum.DEFAULT,
  edgesAreVisible: true,
  metadata: [],
};
const initialState: OxalisState = update(defaultState, {
  tracing: {
    restrictions: {
      allowUpdate: {
        $set: true,
      },
      branchPointsAllowed: {
        $set: true,
      },
    },
    annotationType: { $set: "Explorational" },
    skeleton: {
      $set: initialSkeletonTracing,
    },
  },
});

const position = [10, 10, 10] as Vector3;
const rotation = [0.5, 0.5, 0.5] as Vector3;
const viewport = 0;
const mag = 0;
test("SkeletonTracing should add a new node", (t) => {
  const action = SkeletonTracingActions.createNodeAction(position, null, rotation, viewport, mag);
  const newState = SkeletonTracingReducer(initialState, action);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  // This should be unchanged / sanity check
  t.is(newState.tracing.name, initialState.tracing.name);
  t.is(newSkeletonTracing.activeTreeId, initialSkeletonTracing.activeTreeId);
  t.is(newSkeletonTracing.trees[1].branchPoints, initialSkeletonTracing.trees[1].branchPoints);
  t.is(newSkeletonTracing.trees[1].treeId, initialSkeletonTracing.trees[1].treeId);
  t.is(newSkeletonTracing.trees[1].name, initialSkeletonTracing.trees[1].name);

  // This should be changed
  const maxNodeId = _.max(Array.from(newSkeletonTracing.trees[1].nodes.keys()));

  t.is(maxNodeId, 1);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.deepEqual(newSkeletonTracing.trees[1].edges.size(), 0);
  deepEqualObjectContaining(t, newSkeletonTracing.trees[1].nodes.getOrThrow(1), {
    untransformedPosition: position,
    rotation,
    viewport,
    mag,
    id: 1,
    radius: 1,
  });
});
test("SkeletonTracing should add a several nodes", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  // create three nodes
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  t.not(newState, initialState);

  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  const maxNodeId = _.max(
    _.flatMap(newSkeletonTracing.trees, (tree) => tree.nodes.map((node: Node) => node.id)),
  );

  t.is(maxNodeId, 3);
  t.is(newSkeletonTracing.activeNodeId, 3);
  t.deepEqual(newSkeletonTracing.trees[1].nodes.size(), 3);
  t.deepEqual(newSkeletonTracing.trees[1].edges.size(), 2);
  t.deepEqual(newSkeletonTracing.trees[1].edges.asArray(), [
    {
      source: 1,
      target: 2,
    },
    {
      source: 2,
      target: 3,
    },
  ]);
});
test("SkeletonTracing should add nodes to a different tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  // add a node to initial tree, then create a second tree and add two nodes
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  t.not(newState, initialState);

  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  const maxNodeId = _.max(
    _.flatMap(newSkeletonTracing.trees, (tree) => tree.nodes.map((node) => node.id)),
  );

  t.is(maxNodeId, 3);
  t.is(newSkeletonTracing.activeTreeId, 2);
  t.is(newSkeletonTracing.activeNodeId, 3);
  t.deepEqual(newSkeletonTracing.trees[1].nodes.size(), 1);
  t.deepEqual(newSkeletonTracing.trees[2].nodes.size(), 2);
  t.deepEqual(newSkeletonTracing.trees[1].edges.size(), 0);
  t.deepEqual(newSkeletonTracing.trees[2].edges.asArray(), [
    {
      source: 2,
      target: 3,
    },
  ]);
});
test("SkeletonTracing shouldn't delete the tree if 'delete node' is initiated for an empty tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
  const newStateA = SkeletonTracingReducer(initialState, createTreeAction);
  const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);
  t.deepEqual(newStateA, newStateB);
});
test("SkeletonTracing should delete the tree if 'delete node as user' is initiated for an empty tree", (t) => {
  const { createTreeAction, deleteNodeAsUserAction } = SkeletonTracingActions;
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction())
    .apply(SkeletonTracingReducer, (currentState: OxalisState) =>
      deleteNodeAsUserAction(currentState),
    )
    .unpack();
  t.deepEqual(newState, initialState);
});
test("SkeletonTracing should delete a node from a tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
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
test("SkeletonTracing should delete respective comments and branchpoints when deleting a node from a tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
  const createCommentAction = SkeletonTracingActions.createCommentAction("foo");
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  // Add a node, comment, and branchpoint, then delete the node again
  const newState = SkeletonTracingReducer(initialState, createNodeAction);
  const newStateA = SkeletonTracingReducer(newState, createCommentAction);
  const newStateB = SkeletonTracingReducer(newStateA, createBranchPointAction);
  const newStateC = SkeletonTracingReducer(newStateB, deleteNodeAction);
  // Workaround, because the diffable map creates a new chunk but doesn't delete it again
  const nodes = enforceSkeletonTracing(newStateC.tracing).trees[1].nodes;
  t.is(nodes.chunks.length, 1);
  t.is(nodes.chunks[0].size, 0);
  nodes.chunks = [];
  t.deepEqual(newStateC, initialState);
});
test("SkeletonTracing should not delete tree when last node is deleted from the tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
  // Create tree, add two nodes, then delete them again so that the tree is removed, as well
  const emptyTreeState = SkeletonTracingReducer(
    initialState,
    SkeletonTracingActions.createTreeAction(),
  );
  const emptySkeletonTracing = enforceSkeletonTracing(emptyTreeState.tracing);
  const newState = ChainReducer<OxalisState, Action>(emptyTreeState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .unpack();
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(
    _.map(emptySkeletonTracing.trees, (tree) => tree.nodes.size()),
    _.map(newSkeletonTracing.trees, (tree) => tree.nodes.size()),
  );
});
test("SkeletonTracing should delete nodes and split the tree", (t) => {
  const createDummyNode = (id: number): Node => ({
    bitDepth: 8,
    id,
    untransformedPosition: [0, 0, 0],
    additionalCoordinates: null,
    radius: 10,
    mag: 10,
    rotation: [0, 0, 0],
    timestamp: 0,
    viewport: 1,
    interpolation: true,
  });

  const state = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          $set: {
            [0]: {
              treeId: 0,
              name: "TestTree-0",
              nodes: new DiffableMap([
                [0, createDummyNode(0)],
                [1, createDummyNode(1)],
                [2, createDummyNode(2)],
                [7, createDummyNode(7)],
              ]),
              timestamp: Date.now(),
              branchPoints: [
                {
                  nodeId: 1,
                  timestamp: 0,
                },
                {
                  nodeId: 7,
                  timestamp: 0,
                },
              ],
              edges: EdgeCollection.loadFromArray([
                {
                  source: 0,
                  target: 1,
                },
                {
                  source: 2,
                  target: 1,
                },
                {
                  source: 1,
                  target: 7,
                },
              ]),
              comments: [
                {
                  content: "comment",
                  nodeId: 0,
                },
              ],
              color: [23, 23, 23],
              groupId: MISSING_GROUP_ID,
              isVisible: true,
              type: TreeTypeEnum.DEFAULT,
              edgesAreVisible: true,
              metadata: [],
            },
            [1]: {
              treeId: 1,
              name: "TestTree-1",
              nodes: new DiffableMap([
                [4, createDummyNode(4)],
                [5, createDummyNode(5)],
                [6, createDummyNode(6)],
              ]),
              timestamp: Date.now(),
              branchPoints: [],
              edges: EdgeCollection.loadFromArray([
                {
                  source: 4,
                  target: 5,
                },
                {
                  source: 5,
                  target: 6,
                },
              ]),
              comments: [],
              color: [30, 30, 30],
              groupId: MISSING_GROUP_ID,
              isVisible: true,
              type: TreeTypeEnum.DEFAULT,
              edgesAreVisible: true,
              metadata: [],
            },
          },
        },
      },
    },
  });
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
  // Delete the second node
  const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
  const state1 = SkeletonTracingReducer(state0, deleteNodeAction);
  const newTrees = enforceSkeletonTracing(state1.tracing).trees;
  t.is(Object.keys(newTrees).length, 4);
  t.is(newTrees[0].nodes.getOrThrow(0).id, 0);
  t.is(newTrees[0].comments.length, 1);
  t.is(newTrees[0].comments[0].nodeId, 0);
  t.is(newTrees[2].nodes.getOrThrow(2).id, 2);
  t.is(newTrees[1].nodes.getOrThrow(4).id, 4);
  t.is(newTrees[3].nodes.getOrThrow(7).id, 7);
  t.is(newTrees[3].branchPoints[0].nodeId, 7);
});
test("SkeletonTracing should not delete an edge if the two nodes are not neighbors", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(0, 3);
  // Create a couple of nodes
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newStateA = SkeletonTracingReducer(newState, deleteEdgeAction);
  t.is(newState, newStateA);
});
test("SkeletonTracing should not delete an edge if the both nodes are identical", (t) => {
  const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(0, 0);
  const newStateA = SkeletonTracingReducer(initialState, deleteEdgeAction);
  t.is(initialState, newStateA);
});
test("SkeletonTracing should not delete any edge if the two nodes are in different trees", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(0, 2);
  // Create a couple of nodes
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newStateA = SkeletonTracingReducer(newState, deleteEdgeAction);
  t.is(newState, newStateA);
});
test("SkeletonTracing should delete an edge and split the tree", (t) => {
  const createDummyNode = (id: number): Node => ({
    bitDepth: 8,
    id,
    untransformedPosition: [0, 0, 0],
    additionalCoordinates: null,
    radius: 10,
    mag: 10,
    rotation: [0, 0, 0],
    timestamp: 0,
    viewport: 1,
    interpolation: true,
  });

  const state = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          $set: {
            [0]: {
              treeId: 0,
              name: "TestTree-0",
              nodes: new DiffableMap([
                [0, createDummyNode(0)],
                [1, createDummyNode(1)],
                [2, createDummyNode(2)],
                [7, createDummyNode(7)],
              ]),
              timestamp: Date.now(),
              branchPoints: [
                {
                  nodeId: 1,
                  timestamp: 0,
                },
                {
                  nodeId: 7,
                  timestamp: 0,
                },
              ],
              edges: EdgeCollection.loadFromArray([
                {
                  source: 0,
                  target: 1,
                },
                {
                  source: 2,
                  target: 1,
                },
                {
                  source: 2,
                  target: 7,
                },
              ]),
              comments: [
                {
                  content: "comment",
                  nodeId: 7,
                },
              ],
              color: [23, 23, 23],
              groupId: MISSING_GROUP_ID,
              isVisible: true,
              type: TreeTypeEnum.DEFAULT,
              edgesAreVisible: true,
              metadata: [],
            },
            [1]: {
              treeId: 1,
              name: "TestTree-1",
              nodes: new DiffableMap([
                [4, createDummyNode(4)],
                [5, createDummyNode(5)],
                [6, createDummyNode(6)],
              ]),
              timestamp: Date.now(),
              branchPoints: [],
              edges: EdgeCollection.loadFromArray([
                {
                  source: 4,
                  target: 5,
                },
                {
                  source: 5,
                  target: 6,
                },
              ]),
              comments: [],
              color: [30, 30, 30],
              groupId: MISSING_GROUP_ID,
              isVisible: true,
              type: TreeTypeEnum.DEFAULT,
              edgesAreVisible: true,
              metadata: [],
            },
          },
        },
      },
    },
  });
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
  const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(1, 2);
  const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
  const state1 = SkeletonTracingReducer(state0, deleteEdgeAction);
  const newTrees = enforceSkeletonTracing(state1.tracing).trees;
  t.is(Object.keys(newTrees).length, 3);
  t.is(newTrees[0].nodes.getOrThrow(0).id, 0);
  t.is(newTrees[0].nodes.size(), 2);
  t.is(newTrees[0].branchPoints[0].nodeId, 1);
  t.is(newTrees[1].nodes.getOrThrow(4).id, 4);
  t.is(newTrees[1].nodes.size(), 3);
  t.is(newTrees[2].comments.length, 1);
  t.is(newTrees[2].comments[0].nodeId, 7);
  t.is(newTrees[2].nodes.getOrThrow(2).id, 2);
  t.is(newTrees[2].nodes.getOrThrow(7).id, 7);
  t.is(newTrees[2].nodes.size(), 2);
  t.is(newTrees[2].branchPoints[0].nodeId, 7);
});
test("SkeletonTracing should set a new active node", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
  // Create two nodes, then set first one active
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveNodeAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should set a new active node in a different tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
  // Create one node in the first tree, then set create second tree with two nodes
  // Then set first node of second tree active
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createTreeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setActiveNodeAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should set a new node radius", (t) => {
  const newRadius = 10;
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const setNodeRadiusAction = SkeletonTracingActions.setNodeRadiusAction(newRadius);
  // Create a node and change its radius
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, setNodeRadiusAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].nodes.getOrThrow(1).radius, newRadius);
});
test("SkeletonTracing should create a branchpoint", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  // create a single node and then set it as branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints.length, 1);
  deepEqualObjectContaining(t, newSkeletonTracing.trees[1].branchPoints[0], {
    nodeId: 1,
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
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

  // create a node and set a branch point in tracing without the correct permissions
  const startState = update(initialState, {
    tracing: { restrictions: { branchPointsAllowed: { $set: false } } },
  });

  let newState = SkeletonTracingReducer(startState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints.length, 0);
});
test("SkeletonTracing shouldn't create more branchpoints than nodes", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  // create one node and set it as branchpoint three times
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints.length, 1);
  deepEqualObjectContaining(t, newSkeletonTracing.trees[1].branchPoints[0], {
    nodeId: 1,
  });
});
test("SkeletonTracing should delete a branchpoint", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();
  // create one node and set it as branchpoint, create a second node and jump back to branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 0);
  t.is(newSkeletonTracing.trees[1].nodes.size(), 2);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should delete specific selected branchpoint", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  // create one node and set it as branchpoint, create a second node and jump back to branchpoint
  let newState = SkeletonTracingReducer(initialState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  newState = SkeletonTracingReducer(newState, createNodeAction);
  newState = SkeletonTracingReducer(newState, createBranchPointAction);
  const deleteBranchpointByIdAction = SkeletonTracingActions.deleteBranchpointByIdAction(1, 1);
  newState = SkeletonTracingReducer(newState, deleteBranchpointByIdAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 1);
  t.is(newSkeletonTracing.trees[1].branchPoints[0].nodeId, 2);
  t.is(newSkeletonTracing.trees[1].nodes.size(), 2);
  t.is(newSkeletonTracing.activeNodeId, 2);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should delete several branchpoints", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
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
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 0);
  t.is(newSkeletonTracing.trees[1].nodes.size(), 2);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing shouldn't delete more branchpoints than available", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
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
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 0);
  t.is(newSkeletonTracing.trees[1].nodes.size(), 1);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should delete a branchpoint from a different tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
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
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 0);
  t.is(newSkeletonTracing.trees[2].branchPoints.length, 0);
});
test("SkeletonTracing should delete a branchpoint from another tree than the active one", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
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
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].branchPoints.length, 0);
  t.is(newSkeletonTracing.trees[2].branchPoints.length, 0);
  // as the branchpoint was in the first tree, the first tree should be active again
  t.is(newSkeletonTracing.activeTreeId, 2);
});
test("SkeletonTracing should add a new tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const newState = SkeletonTracingReducer(initialState, createTreeAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(_.size(newSkeletonTracing.trees), 2);
  t.is(newSkeletonTracing.trees[1].treeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 2);
  t.is(newSkeletonTracing.activeNodeId, null);
  deepEqualObjectContaining(t, newSkeletonTracing.trees[2], {
    comments: [],
    branchPoints: [],
    nodes: new DiffableMap(),
    treeId: 2,
    color: [0, 0, 1],
  });
});
test("SkeletonTracing should add a several new trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  // create three trees
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(_.size(newSkeletonTracing.trees), 4);
  t.is(_.max(_.map(newSkeletonTracing.trees, "treeId")), 4);
  t.is(newSkeletonTracing.activeTreeId, 4);
  t.is(newSkeletonTracing.activeNodeId, null);
});
test("SkeletonTracing should delete a new tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();
  // create a tree and delete it again
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .unpack();
  t.not(newState, initialState);
  t.deepEqual(newState, initialState);
});
test("SkeletonTracing should delete several trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();
  // create trees and delete them
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(_.size(newSkeletonTracing.trees), 0);
  t.not(newSkeletonTracing.trees, initialSkeletonTracing.trees);
});
test("SkeletonTracing should delete several trees at once", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreesAction = SkeletonTracingActions.deleteTreesAction([1, 2, 3]);
  // create trees and delete them
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, deleteTreesAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(_.size(newSkeletonTracing.trees), 0);
  t.not(newSkeletonTracing.trees, initialSkeletonTracing.trees);
});
test("SkeletonTracing should set a new active tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(2);
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, setActiveTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 2);
  t.is(newSkeletonTracing.activeNodeId, null);
});
test("SkeletonTracing should set a different active tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(2);
  // create a second tree with two nodes and set it active
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setActiveTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 2);
  t.is(newSkeletonTracing.activeNodeId, 2);
});
test("SkeletonTracing shouldn't set a new active tree for unknown tree ids", (t) => {
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(10);
  const newState = SkeletonTracingReducer(initialState, setActiveTreeAction);
  t.is(newState, initialState);
});
test("SkeletonTracing should merge two trees", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
  // create a node in first tree, then create a second tree with three nodes and merge them
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(_.size(newSkeletonTracing.trees), 1);
  t.is(newSkeletonTracing.trees[2].nodes.size(), 4);
  t.deepEqual(newSkeletonTracing.trees[2].edges.asArray(), [
    {
      source: 2,
      target: 3,
    },
    {
      source: 3,
      target: 4,
    },
    {
      source: 3,
      target: 1,
    },
  ]);
});
test("SkeletonTracing shouldn't merge the same tree", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 3);
  // create a node in first tree, then create a second tree with three nodes and merge them
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);
  t.is(newState, testState);
});
test("SkeletonTracing should merge two trees with comments and branchPoints", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
  const createCommentAction = SkeletonTracingActions.createCommentAction("foo");
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
  // create a node in first tree, then create a second tree with three nodes and merge them
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createBranchPointAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(_.size(newSkeletonTracing.trees), 1);
  t.is(newSkeletonTracing.trees[2].nodes.size(), 4);
  t.deepEqual(newSkeletonTracing.trees[2].edges.asArray(), [
    {
      source: 2,
      target: 3,
    },
    {
      source: 3,
      target: 4,
    },
    {
      source: 3,
      target: 1,
    },
  ]);
  t.is(newSkeletonTracing.trees[2].comments.length, 2);
  t.is(newSkeletonTracing.trees[2].branchPoints.length, 1);
});
test("SkeletonTracing should rename the active tree", (t) => {
  const newName = "SuperTestName";
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName);
  const newState = SkeletonTracingReducer(initialState, setTreeNameAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].name, newName);
});
test("SkeletonTracing should rename the active tree to a default name", (t) => {
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction();
  const newState = SkeletonTracingReducer(initialState, setTreeNameAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].name, "Tree001");
});
test("SkeletonTracing should increase the activeTreeId", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(1);
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction();
  // create a second tree, set first tree active then increase activeTreeId
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, setActiveTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 2);
});
test("SkeletonTracing should decrease the activeTreeId", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction(false);
  // create a second tree then decrease activeTreeId
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should wrap around when decreasing the activeTreeId below 1", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction(false);
  // create a second tree then decrease activeTreeId twice
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 2);
});
test("SkeletonTracing should be able to select next tree when tree ids are not consecutive", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction(2);
  const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction();
  // create a second tree then decrease activeTreeId twice
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .apply(SkeletonTracingReducer, selectNextTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.activeTreeId, 3);
});
test("SkeletonTracing should shuffle the color of a specified tree", (t) => {
  const shuffleTreeColorAction = SkeletonTracingActions.shuffleTreeColorAction(1);
  const newState = SkeletonTracingReducer(initialState, shuffleTreeColorAction);
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.notDeepEqual(newSkeletonTracing.trees[1].color, [23, 23, 23]);
});
test("SkeletonTracing should create a comment for the active node", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  // create a single node with a comment
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].content, commentText);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].nodeId, 1);
});
test("SkeletonTracing shouldn't create a comments if there is no active node", (t) => {
  const commentText = "Wow such test comment";
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const newState = SkeletonTracingReducer(initialState, createCommentAction);
  t.is(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 0);
});
test("SkeletonTracing shouldn't create more than one comment for the active node", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  // create a node and add the same comment three times
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 1);
});
test("SkeletonTracing should create comments for several nodes", (t) => {
  const commentText1 = "Wow such test comment";
  const commentText2 = "Amaze test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  // create two nodes with a different comment each
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, SkeletonTracingActions.createCommentAction(commentText1))
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, SkeletonTracingActions.createCommentAction(commentText2))
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 2);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].content, commentText1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].nodeId, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[1].content, commentText2);
  t.deepEqual(newSkeletonTracing.trees[1].comments[1].nodeId, 2);
});
test("SkeletonTracing should create comments for a different tree", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 0);
  t.deepEqual(newSkeletonTracing.trees[2].comments.length, 1);
});
test("SkeletonTracing should delete a comment for a node", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction();
  // create a node with a comment, then delete it
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, deleteCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 0);
});

test("SkeletonTracing should only delete the comment for the active node", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction();
  // create two nodes with a comment each and delete the comment for the last node
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, deleteCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].nodeId, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].content, commentText);
});
test("SkeletonTracing should add a node in a specified tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
    2,
  );
  // create a few trees and add a node to a specific one
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.truthy(newSkeletonTracing.trees[2].nodes.getOrThrow(1));
  t.is(newSkeletonTracing.activeTreeId, 2);
  t.is(newSkeletonTracing.activeNodeId, 1);
});
test("SkeletonTracing should delete a specified node (1/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(2, 1);
  // create three nodes and delete a specific one
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.falsy(newSkeletonTracing.trees[1].nodes.has(2));
  // tree is split
  t.truthy(newSkeletonTracing.trees[2]);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should delete a specified node (2/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  // create three nodes and delete a specific one
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.falsy(newSkeletonTracing.trees[1].nodes.has(2));
  // tree is split
  t.truthy(newSkeletonTracing.trees[2]);
  t.is(newSkeletonTracing.activeNodeId, 1);
  t.is(newSkeletonTracing.activeTreeId, 1);
});
test("SkeletonTracing should create a branchpoint for a specified node (1/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(2, 1);
  // create some nodes and then set a specific one as branchpoint
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createBranchPointAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints.length, 1);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints[0].nodeId, 2);
});
test("SkeletonTracing should create a branchpoint for a specified node (2/2)", (t) => {
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(2, 1);
  // create some nodes and then set a specific one as branchpoint
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createBranchPointAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints.length, 1);
  t.deepEqual(newSkeletonTracing.trees[1].branchPoints[0].nodeId, 2);
});
test("SkeletonTracing should delete a specified tree", (t) => {
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const deleteTreeAction = SkeletonTracingActions.deleteTreeAction(2);
  // create some trees and delete a specific one
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.falsy(newSkeletonTracing.trees[2]);
  t.truthy(newSkeletonTracing.trees[3]);
  t.is(newSkeletonTracing.activeTreeId, 3);
});
test("SkeletonTracing should rename a specified tree", (t) => {
  const newName = "SuperTestName";
  const createTreeAction = SkeletonTracingActions.createTreeAction();
  const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName, 2);
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, setTreeNameAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[2].name, newName);
  t.notDeepEqual(newSkeletonTracing.trees[1].name, newName);
  t.notDeepEqual(newSkeletonTracing.trees[3].name, newName);
});
test("SkeletonTracing should create a comment for a specified node", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText, 2);
  // create a few nodes and adds one comment
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].content, commentText);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].nodeId, 2);
});
test("SkeletonTracing should delete a comment for a specified node (1/2)", (t) => {
  const commentText = "Wow such test comment";
  const createNodeAction = SkeletonTracingActions.createNodeAction(
    position,
    null,
    rotation,
    viewport,
    mag,
  );
  const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
  const deleteCommentAction = SkeletonTracingActions.deleteCommentAction(2);
  // create nodes with comments, then delete a specific comment
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .apply(SkeletonTracingReducer, deleteCommentAction)
    .unpack();
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.deepEqual(newSkeletonTracing.trees[1].comments.length, 2);
  t.deepEqual(newSkeletonTracing.trees[1].comments[0].nodeId, 1);
  t.deepEqual(newSkeletonTracing.trees[1].comments[1].nodeId, 3);
});
test("SkeletonTracing should change the color of a specified tree", (t) => {
  const colorIndex = 10;
  const newState = SkeletonTracingReducer(
    initialState,
    SkeletonTracingActions.setTreeColorIndexAction(1, colorIndex),
  );
  t.not(newState, initialState);
  const newSkeletonTracing = enforceSkeletonTracing(newState.tracing);
  t.is(newSkeletonTracing.trees[1].color, colors[colorIndex - 1]);
});

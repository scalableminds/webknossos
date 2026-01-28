import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import {
  initialState as defaultState,
  initialSkeletonTracing,
  initialTreeOne,
} from "test/fixtures/hybridtracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  addTreesAndGroupsAction,
  createBranchPointAction,
  createCommentAction,
  createNodeAction,
  createTreeAction,
  deleteBranchPointAction,
  deleteBranchpointByIdAction,
  deleteCommentAction,
  deleteEdgeAction,
  deleteNodeAction,
  deleteTreeAction,
  deleteTreesAction,
  mergeTreesAction,
  selectNextTreeAction,
  setActiveNodeAction,
  setActiveTreeAction,
  setNodeRadiusAction,
  setTreeColorIndexAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  setTreeNameAction,
  shuffleTreeColorAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { deleteNodeAsUserAction } from "viewer/model/actions/skeletontracing_actions_with_effects";
import EdgeCollection from "viewer/model/edge_collection";
import { max } from "viewer/model/helpers/iterator_utils";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import {
  type MutableNode,
  MutableTreeMap,
  type Node,
  type Tree,
  TreeMap,
} from "viewer/model/types/tree_types";
import type { WebknossosState } from "viewer/store";
import { MISSING_GROUP_ID } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { describe, expect, it } from "vitest";

const initialState: WebknossosState = update(defaultState, {
  annotation: {
    restrictions: {
      allowUpdate: {
        $set: true,
      },
      branchPointsAllowed: {
        $set: true,
      },
    },
    isUpdatingCurrentlyAllowed: { $set: true },
    annotationType: { $set: "Explorational" },
  },
});

const initialStateWithActiveTreeId2 = update(initialState, {
  annotation: {
    skeleton: {
      activeTreeId: { $set: 2 },
    },
  },
});
const position = [10, 10, 10] as Vector3;
const rotation = [0.5, 0.5, 0.5] as Vector3;
const viewport = 0;
const mag = 0;

const applyActions = chainReduce(SkeletonTracingReducer);

describe("SkeletonTracing", () => {
  it("should add a new node", () => {
    const action = createNodeAction(position, null, rotation, viewport, mag);
    const newState = SkeletonTracingReducer(initialState, action);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);

    // This should be unchanged / sanity check
    expect(newState.annotation.name).toBe(initialState.annotation.name);
    expect(newSkeletonTracing.activeTreeId).toBe(initialSkeletonTracing.activeTreeId);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints).toBe(
      initialSkeletonTracing.trees.getOrThrow(1).branchPoints,
    );
    expect(newSkeletonTracing.trees.getOrThrow(1).treeId).toBe(
      initialSkeletonTracing.trees.getOrThrow(1).treeId,
    );
    expect(newSkeletonTracing.trees.getOrThrow(1).name).toBe(
      initialSkeletonTracing.trees.getOrThrow(1).name,
    );

    // This should be changed
    const maxNodeId = max(newSkeletonTracing.trees.getOrThrow(1).nodes.keys());

    expect(maxNodeId).toBe(1);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).edges.size()).toEqual(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.getOrThrow(1)).toEqual(
      expect.objectContaining({
        untransformedPosition: position,
        rotation,
        viewport,
        mag,
        id: 1,
        radius: 1,
      }),
    );
  });

  it("should add a several nodes", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    // create three nodes
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createNode);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    const maxNodeId = max(
      newSkeletonTracing.trees.values().flatMap((tree) => tree.nodes.map((node: Node) => node.id)),
    );

    expect(maxNodeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toEqual(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).edges.size()).toEqual(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).edges.toArray()).toEqual([
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

  it("should add nodes to a different tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createTree = createTreeAction();
    // add a node to initial tree, then create a second tree and add two nodes
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createTree);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createNode);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    const maxNodeId = max(
      newSkeletonTracing.trees.values().flatMap((tree) => tree.nodes.map((node) => node.id)),
    );

    expect(maxNodeId).toBe(3);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toEqual(1);
    expect(newSkeletonTracing.trees.getOrThrow(2).nodes.size()).toEqual(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toEqual(2);
    expect(newSkeletonTracing.trees.getOrThrow(2).edges.size()).toEqual(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.toArray()).toEqual([
      {
        source: 2,
        target: 3,
      },
    ]);
  });

  it("shouldn't delete the tree if 'delete node' is initiated for an empty tree", () => {
    const createTree = createTreeAction();
    const deleteNode = deleteNodeAction();
    const newStateA = SkeletonTracingReducer(initialState, createTree);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNode);

    expect(newStateA).toEqual(newStateB);
  });

  it("should delete the tree if 'delete node as user' is initiated for an empty tree", () => {
    const newState = applyActions(initialStateWithActiveTreeId2, [
      createTreeAction(),
      (currentState: WebknossosState) => deleteNodeAsUserAction(currentState),
    ]);

    expect(newState).toEqual(initialStateWithActiveTreeId2);
  });

  it("should delete a node from a tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteNode = deleteNodeAction();
    // Add two nodes, then delete one
    const newState = SkeletonTracingReducer(initialState, createNode);
    const newStateA = SkeletonTracingReducer(newState, createNode);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNode);

    expect(newStateB).not.toBe(newState);
    expect(newStateB).not.toBe(newStateA);
    expect(newStateA).not.toBe(newState);
    expect(enforceSkeletonTracing(newStateB.annotation).trees).toEqual(
      enforceSkeletonTracing(newState.annotation).trees,
    );
  });

  it("should delete respective comments and branchpoints when deleting a node from a tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteNode = deleteNodeAction();
    const createComment = createCommentAction("foo");
    const createBranchPoint = createBranchPointAction();

    // Add a node, comment, and branchpoint, then delete the node again
    const newState = SkeletonTracingReducer(initialState, createNode);
    const newStateA = SkeletonTracingReducer(newState, createComment);
    const newStateB = SkeletonTracingReducer(newStateA, createBranchPoint);
    const newStateC = SkeletonTracingReducer(newStateB, deleteNode);

    // Workaround, because the diffable map creates a new chunk but doesn't delete it again
    const nodes = enforceSkeletonTracing(newStateC.annotation).trees.getOrThrow(1).nodes;
    expect(nodes.chunks.length).toBe(1);
    expect(nodes.chunks[0].size).toBe(0);
    nodes.chunks = [];
    expect(newStateC).toEqual(initialState);
  });

  it("should not delete tree when last node is deleted from the tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteNode = deleteNodeAction();

    // Create tree, add two nodes, then delete them again so that the tree is removed, as well
    const emptyTreeState = SkeletonTracingReducer(initialState, createTreeAction());

    const emptySkeletonTracing = enforceSkeletonTracing(emptyTreeState.annotation);
    const newState = applyActions(emptyTreeState, [createNode, createNode, deleteNode, deleteNode]);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(emptySkeletonTracing.trees.values().map((tree) => tree.nodes.size())).toEqual(
      newSkeletonTracing.trees.values().map((tree) => tree.nodes.size()),
    );
  });

  it("should delete nodes and split the tree", () => {
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
      annotation: {
        skeleton: {
          trees: {
            $set: new TreeMap([
              [
                0,
                {
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
              ],
              [
                1,
                {
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
              ],
            ]),
          },
        },
      },
    });
    const setActiveNode = setActiveNodeAction(1);
    const deleteNode = deleteNodeAction();

    // Delete the second node
    const state0 = SkeletonTracingReducer(state, setActiveNode);
    const state1 = SkeletonTracingReducer(state0, deleteNode);
    const newTrees = enforceSkeletonTracing(state1.annotation).trees;

    expect(newTrees.size()).toBe(4);
    expect(newTrees.getOrThrow(0).nodes.getOrThrow(0).id).toBe(0);
    expect(newTrees.getOrThrow(0).comments.length).toBe(1);
    expect(newTrees.getOrThrow(0).comments[0].nodeId).toBe(0);
    expect(newTrees.getOrThrow(2).nodes.getOrThrow(2).id).toBe(2);
    expect(newTrees.getOrThrow(1).nodes.getOrThrow(4).id).toBe(4);
    expect(newTrees.getOrThrow(3).nodes.getOrThrow(7).id).toBe(7);
    expect(newTrees.getOrThrow(3).branchPoints[0].nodeId).toBe(7);
  });

  it("should not delete an edge if the two nodes are not neighbors", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteEdge = deleteEdgeAction(0, 3);
    // Create a couple of nodes
    const newState = applyActions(initialState, [createNode, createNode, createNode, createNode]);

    const newStateA = SkeletonTracingReducer(newState, deleteEdge);
    expect(newState).toEqual(newStateA);
  });

  it("should not delete an edge if the both nodes are identical", () => {
    const deleteEdge = deleteEdgeAction(0, 0);
    const newStateA = SkeletonTracingReducer(initialState, deleteEdge);

    expect(initialState).toEqual(newStateA);
  });

  it("should not delete any edge if the two nodes are in different trees", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createTree = createTreeAction();
    const deleteEdge = deleteEdgeAction(0, 2);

    // Create a couple of nodes
    const newState = applyActions(initialState, [createNode, createTree, createNode, createNode]);

    const newStateA = SkeletonTracingReducer(newState, deleteEdge);
    expect(newState).toEqual(newStateA);
  });

  it("should delete an edge and split the tree", () => {
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
      annotation: {
        skeleton: {
          trees: {
            $set: new TreeMap([
              [
                0,
                {
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
              ],
              [
                1,
                {
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
              ],
            ]),
          },
        },
      },
    });

    const setActiveNode = setActiveNodeAction(1);
    const deleteEdge = deleteEdgeAction(1, 2);
    const state0 = SkeletonTracingReducer(state, setActiveNode);
    const state1 = SkeletonTracingReducer(state0, deleteEdge);

    const newTrees = enforceSkeletonTracing(state1.annotation).trees;
    expect(newTrees.size()).toBe(3);
    expect(newTrees.getOrThrow(0).nodes.getOrThrow(0).id).toBe(0);
    expect(newTrees.getOrThrow(0).nodes.size()).toBe(2);
    expect(newTrees.getOrThrow(0).branchPoints[0].nodeId).toBe(1);
    expect(newTrees.getOrThrow(1).nodes.getOrThrow(4).id).toBe(4);
    expect(newTrees.getOrThrow(1).nodes.size()).toBe(3);
    expect(newTrees.getOrThrow(2).comments.length).toBe(1);
    expect(newTrees.getOrThrow(2).comments[0].nodeId).toBe(7);
    expect(newTrees.getOrThrow(2).nodes.getOrThrow(2).id).toBe(2);
    expect(newTrees.getOrThrow(2).nodes.getOrThrow(7).id).toBe(7);
    expect(newTrees.getOrThrow(2).nodes.size()).toBe(2);
    expect(newTrees.getOrThrow(2).branchPoints[0].nodeId).toBe(7);
  });

  it("should set a new active node", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const setActiveNode = setActiveNodeAction(1);

    // Create two nodes, then set first one active
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, setActiveNode);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should set a new active node in a different tree", () => {
    const createTree = createTreeAction();
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const setActiveNode = setActiveNodeAction(1);

    // Create one node in the first tree, then set create second tree with two nodes
    // Then set first node of second tree active
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createTree);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, setActiveNode);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should set a new node radius", () => {
    const newRadius = 10;
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const setNodeRadius = setNodeRadiusAction(newRadius);

    // Create a node and change its radius
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, setNodeRadius);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.getOrThrow(1).radius).toEqual(newRadius);
  });

  it("should create a branchpoint", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();

    // create a single node and then set it as branchpoint
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0]).toEqual(
      expect.objectContaining({
        nodeId: 1,
      }),
    );
  });

  it("shouldn't create a branchpoint in an empty tree", () => {
    const createBranchPoint = createBranchPointAction();

    // create a branchpoint in a tree without any nodes
    const newState = SkeletonTracingReducer(initialState, createBranchPoint);
    expect(newState).toBe(initialState);
  });

  it("shouldn't create a branchpoint without the correct permissions", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();

    // create a node and set a branch point in tracing without the correct permissions
    const startState = update(initialState, {
      annotation: { restrictions: { branchPointsAllowed: { $set: false } } },
    });

    let newState = SkeletonTracingReducer(startState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
  });

  it("shouldn't create more branchpoints than nodes", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();

    // create one node and set it as branchpoint three times
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0]).toEqual(
      expect.objectContaining({
        nodeId: 1,
      }),
    );
  });

  it("should delete a branchpoint", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();
    const deleteBranchPoint = deleteBranchPointAction();

    // create one node and set it as branchpoint, create a second node and jump back to branchpoint
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should delete specific selected branchpoint", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();

    // create one node and set it as branchpoint, create a second node and jump back to branchpoint
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);

    const deleteBranchpointById = deleteBranchpointByIdAction(1, 1);
    newState = SkeletonTracingReducer(newState, deleteBranchpointById);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(2);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should delete several branchpoints", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();
    const deleteBranchPoint = deleteBranchPointAction();

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("shouldn't delete more branchpoints than available", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction();
    const deleteBranchPoint = deleteBranchPointAction();

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initialState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(1);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should delete a branchpoint from a different tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createTree = createTreeAction();
    const createBranchPoint = createBranchPointAction();
    const deleteBranchPoint = deleteBranchPointAction();

    // create a new tree, add a node, set it as branchpoint twice then delete the branchpoint
    let newState = SkeletonTracingReducer(initialState, createTree);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, createBranchPoint);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).branchPoints.length).toBe(0);
  });

  it("should delete a branchpoint from another tree than the active one", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createTree = createTreeAction();
    const createBranchPoint = createBranchPointAction();
    const deleteBranchPoint = deleteBranchPointAction();

    // create a new tree, add a node, set it as branchpoint
    let newState = SkeletonTracingReducer(initialState, createTree);
    newState = SkeletonTracingReducer(newState, createNode);
    newState = SkeletonTracingReducer(newState, createBranchPoint);

    // create another tree, delete the original branchpoint
    newState = SkeletonTracingReducer(newState, createTree);
    newState = SkeletonTracingReducer(newState, deleteBranchPoint);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).branchPoints.length).toBe(0);
    // as the branchpoint was in the third tree, the third tree should be active again
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });

  it("should add a new tree", () => {
    const createTree = createTreeAction();
    const newState = SkeletonTracingReducer(initialState, createTree);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).treeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
    expect(newSkeletonTracing.trees.getOrThrow(3)).toMatchObject({
      comments: [],
      branchPoints: [],
      nodes: new DiffableMap(),
      treeId: 3,
      color: [0.8509803921568627, 0.5215686274509804, 0.07058823529411765],
    });
  });

  it("should add a several new trees", () => {
    const createTree = createTreeAction();
    // create three trees
    const newState = applyActions(initialState, [createTree, createTree, createTree]);

    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(5);
    expect(max(newSkeletonTracing.trees.values().map((tree) => tree.treeId))).toBe(5);
    expect(newSkeletonTracing.activeTreeId).toBe(5);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
  });

  it("should delete a new tree", () => {
    const createTree = createTreeAction();
    const deleteTree = deleteTreeAction();

    // create a tree and delete it again
    const newState = applyActions(initialStateWithActiveTreeId2, [createTree, deleteTree]);

    expect(newState).not.toBe(initialStateWithActiveTreeId2);
    expect(newState).toEqual(initialStateWithActiveTreeId2);
  });

  it("should delete several trees", () => {
    const createTree = createTreeAction();
    const deleteTree = deleteTreeAction();

    // create trees and delete them
    const newState = applyActions(initialState, [createTree, deleteTree, deleteTree, deleteTree]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(0);
    expect(newSkeletonTracing.trees).not.toBe(initialSkeletonTracing.trees);
  });

  it("should delete several trees at once", () => {
    const createTree = createTreeAction();
    const deleteTrees = deleteTreesAction([1, 2, 3, 4]);
    // create trees and delete them
    const newState = applyActions(initialState, [createTree, createTree, deleteTrees]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(0);
    expect(newSkeletonTracing.trees).not.toBe(initialSkeletonTracing.trees);
  });

  it("should set a new active tree", () => {
    const createTree = createTreeAction();
    const setActiveTree = setActiveTreeAction(2);
    const newState = applyActions(initialState, [createTree, setActiveTree]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
  });

  it("should set a different active tree", () => {
    const createTree = createTreeAction();
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const setActiveTree = setActiveTreeAction(3);

    // create a second tree with two nodes and set it active
    const newState = applyActions(initialState, [
      createTree,
      createNode,
      createNode,
      createTree,
      setActiveTree,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(2);
  });

  it("shouldn't set a new active tree for unknown tree ids", () => {
    const setActiveTree = setActiveTreeAction(10);
    const newState = SkeletonTracingReducer(initialState, setActiveTree);

    expect(newState).toBe(initialState);
  });

  it("should merge two trees", () => {
    const createTree = createTreeAction();
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const mergeTrees = mergeTreesAction(3, 1);

    // create a node in first tree, then create a second tree with three nodes and merge them
    const newState = applyActions(initialState, [
      createNode,
      createTree,
      createNode,
      createNode,
      createNode,
      mergeTrees,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(4);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.toArray()).toEqual([
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

  it("shouldn't merge the same tree", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const mergeTrees = mergeTreesAction(1, 3);
    // create a node in first tree, then create a second tree with three nodes and merge them
    const testState = applyActions(initialState, [createNode, createNode, createNode]);

    const newState = SkeletonTracingReducer(testState, mergeTrees);
    expect(newState).toBe(testState);
  });

  it("should merge two trees with comments and branchPoints", () => {
    const createTree = createTreeAction();
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const mergeTrees = mergeTreesAction(3, 1);
    const createComment = createCommentAction("foo");
    const createBranchPoint = createBranchPointAction();

    // create a node in first tree, then create a second tree with three nodes and merge them
    const newState = applyActions(initialState, [
      createNode,
      createComment,
      createBranchPoint,
      createTree,
      createNode,
      createNode,
      createComment,
      createNode,
      mergeTrees,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(4);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.toArray()).toEqual([
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
    expect(newSkeletonTracing.trees.getOrThrow(3).comments.length).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).branchPoints.length).toBe(1);
  });

  it("shouldn't merge two trees of different type", () => {
    const nodes: MutableNode[] = [
      {
        id: 0,
        untransformedPosition: [0, 0, 0],
        radius: 10,
        mag: 10,
        rotation: [0, 0, 0],
        timestamp: 0,
        viewport: 1,
        interpolation: true,
        additionalCoordinates: [],
        bitDepth: 8,
      },
      {
        id: 1,
        untransformedPosition: [0, 0, 0],
        radius: 10,
        mag: 10,
        rotation: [0, 0, 0],
        timestamp: 0,
        viewport: 1,
        interpolation: true,
        additionalCoordinates: [],
        bitDepth: 8,
      },
      {
        id: 2,
        untransformedPosition: [0, 0, 0],
        radius: 10,
        mag: 10,
        rotation: [0, 0, 0],
        timestamp: 0,
        viewport: 1,
        interpolation: true,
        additionalCoordinates: [],
        bitDepth: 8,
      },
    ];

    const newAgglomerateTree: Tree = {
      treeId: 1,
      name: "Tree001",
      nodes: new DiffableMap([
        [0, nodes[0]],
        [1, nodes[1]],
        [2, nodes[2]],
      ]),
      timestamp: Date.now(),
      branchPoints: [],
      edges: EdgeCollection.loadFromArray([
        {
          source: 0,
          target: 1,
        },
        { source: 1, target: 2 },
        { source: 2, target: 3 },
      ]),
      comments: [],
      color: [23, 23, 23],
      groupId: MISSING_GROUP_ID,
      isVisible: true,
      type: TreeTypeEnum.DEFAULT,
      edgesAreVisible: true,
      metadata: [],
    };

    const skeletonTracing = enforceSkeletonTracing(initialState.annotation);
    const initialStateWithAgglomerateNodes = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            $set: skeletonTracing.trees.set(3, newAgglomerateTree),
          },
        },
      },
    });

    const createNode = createNodeAction(position, null, rotation, viewport, mag);

    // Create a new agglomerate tree with 3 nodes; then add two nodes to the first tree of type default.
    const newState = applyActions(initialStateWithAgglomerateNodes, [
      // Add two more nodes to tree with id 1.
      createNode, // For tree 1,
      createNode, // For tree 1,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(3);

    // Trying to merge those trees should fail as they have a different type.
    const mergeTrees = mergeTreesAction(5, 2);
    const stateAfterMerge = SkeletonTracingReducer(newState, mergeTrees);
    expect(stateAfterMerge).toBe(newState);
  });

  it("should rename the active tree", () => {
    const newName = "SuperTestName";
    const setTreeName = setTreeNameAction(newName);
    const newState = SkeletonTracingReducer(initialState, setTreeName);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).toBe(newName);
  });

  it("should rename the active tree to a default name", () => {
    const setTreeName = setTreeNameAction();
    const newState = SkeletonTracingReducer(initialState, setTreeName);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).toBe("Tree001");
  });

  it("should increase the activeTreeId", () => {
    const createTree = createTreeAction();
    const setActiveTree = setActiveTreeAction(1);
    const selectNextTree = selectNextTreeAction();

    // create a second tree, set first tree active then increase activeTreeId
    const newState = applyActions(initialState, [createTree, setActiveTree, selectNextTree]);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(2);
  });

  it("should decrease the activeTreeId", () => {
    const createTree = createTreeAction();
    const selectNextTree = selectNextTreeAction(false);

    // create a second tree then decrease activeTreeId
    const newState = applyActions(initialState, [createTree, selectNextTree, selectNextTree]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should wrap around when decreasing the activeTreeId below 1", () => {
    const createTree = createTreeAction();
    const selectNextTree = selectNextTreeAction(false);

    // create a second tree then decrease activeTreeId twice
    const newState = applyActions(initialState, [
      createTree,
      selectNextTree,
      selectNextTree,
      selectNextTree,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });

  it("should be able to select next tree when tree ids are not consecutive", () => {
    const createTree = createTreeAction();
    const deleteTree = deleteTreeAction(3);
    const selectNextTree = selectNextTreeAction();

    // create a second tree then decrease activeTreeId twice
    const newState = applyActions(initialState, [
      createTree,
      createTree,
      deleteTree,
      selectNextTree,
      selectNextTree,
      selectNextTree,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(4);
  });

  it("should shuffle the color of a specified tree", () => {
    const shuffleTreeColor = shuffleTreeColorAction(1);
    const newState = SkeletonTracingReducer(initialState, shuffleTreeColor);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).color).not.toEqual([23, 23, 23]);
  });

  it("should create a comment for the active node", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);

    // create a single node with a comment
    const newState = applyActions(initialState, [createNode, createComment]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
  });

  it("shouldn't create a comments if there is no active node", () => {
    const commentText = "Wow such test comment";
    const createComment = createCommentAction(commentText);
    const newState = SkeletonTracingReducer(initialState, createComment);
    expect(newState).toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
  });

  it("shouldn't create more than one comment for the active node", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);

    // create a node and add the same comment three times
    const newState = applyActions(initialState, [
      createNode,
      createComment,
      createComment,
      createComment,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
  });

  it("should create comments for several nodes", () => {
    const commentText1 = "Wow such test comment";
    const commentText2 = "Amaze test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);

    // create two nodes with a different comment each
    const newState = applyActions(initialState, [
      createNode,
      createCommentAction(commentText1),
      createNode,
      createCommentAction(commentText2),
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[1].content).toBe(commentText2);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[1].nodeId).toBe(2);
  });

  it("should create comments for a different tree", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);
    const createTree = createTreeAction();
    const newState = applyActions(initialState, [createTree, createNode, createComment]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).comments.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).comments.length).toBe(1);
  });

  it("should delete a comment for a node", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);
    const deleteComment = deleteCommentAction();

    // create a node with a comment, then delete it
    const newState = applyActions(initialState, [createNode, createComment, deleteComment]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
  });

  it("should only delete the comment for the active node", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);
    const deleteComment = deleteCommentAction();

    // create two nodes with a comment each and delete the comment for the last node
    const newState = applyActions(initialState, [
      createNode,
      createComment,
      createNode,
      createComment,
      deleteComment,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
  });

  it("should add a node in a specified tree", () => {
    const createTree = createTreeAction();
    const createNode = createNodeAction(position, null, rotation, viewport, mag, 3);

    // create a few trees and add a node to a specific one
    const newState = applyActions(initialState, [createTree, createTree, createNode]);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);

    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.getOrThrow(1)).toBeTruthy();
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
  });

  it("should delete a specified node (1/2)", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteNode = deleteNodeAction(2, 1);

    // create three nodes and delete a specific one
    const newState = applyActions(initialState, [createNode, createNode, createNode, deleteNode]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.has(2)).toBeFalsy();

    // tree is split
    expect(newSkeletonTracing.trees.getOrThrow(2)).toBeTruthy();
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should delete a specified node (2/2)", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const deleteNode = deleteNodeAction(2);

    // create three nodes and delete a specific one
    const newState = applyActions(initialState, [createNode, createNode, createNode, deleteNode]);

    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.has(2)).toBeFalsy();

    // tree is split
    expect(newSkeletonTracing.trees.getOrThrow(2)).toBeTruthy();
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should create a branchpoint for a specified node (1/2)", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction(2, 1);

    // create some nodes and then set a specific one as branchpoint
    const newState = applyActions(initialState, [
      createNode,
      createNode,
      createNode,
      createBranchPoint,
    ]);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
  });

  it("should create a branchpoint for a specified node (2/2)", () => {
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createBranchPoint = createBranchPointAction(2, 1);

    // create some nodes and then set a specific one as branchpoint
    const newState = applyActions(initialState, [
      createNode,
      createNode,
      createNode,
      createBranchPoint,
    ]);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
  });

  it("should delete a specified tree", () => {
    const createTree = createTreeAction();
    const deleteTree = deleteTreeAction(2);

    // create some trees and delete a specific one
    const newState = applyActions(initialState, [createTree, createTree, deleteTree]);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getNullable(2)).toBe(undefined);
    expect(newSkeletonTracing.trees.getOrThrow(3)).toBeTruthy();
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });

  it("should rename a specified tree", () => {
    const newName = "SuperTestName";
    const createTree = createTreeAction();
    const setTreeName = setTreeNameAction(newName, 2);

    const newState = applyActions(initialState, [createTree, createTree, setTreeName]);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(2).name).toBe(newName);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).not.toBe(newName);
    expect(newSkeletonTracing.trees.getOrThrow(3).name).not.toBe(newName);
  });

  it("should create a comment for a specified node", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText, 2);

    // create a few nodes and adds one comment
    const newState = applyActions(initialState, [
      createNode,
      createNode,
      createNode,
      createComment,
    ]);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(2);
  });

  it("should delete a comment for a specified node (1/2)", () => {
    const commentText = "Wow such test comment";
    const createNode = createNodeAction(position, null, rotation, viewport, mag);
    const createComment = createCommentAction(commentText);
    const deleteComment = deleteCommentAction(2);

    // create nodes with comments, then delete a specific comment
    const newState = applyActions(initialState, [
      createNode,
      createComment,
      createNode,
      createComment,
      createNode,
      createComment,
      deleteComment,
    ]);

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[1].nodeId).toBe(3);
  });

  it("should change the color of a specified tree", () => {
    const colorIndex = 10;
    const newState = SkeletonTracingReducer(initialState, setTreeColorIndexAction(1, colorIndex));
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).color).not.toEqual([23, 23, 23]);
  });

  it("should toggle inactive trees", () => {
    const createTree = createTreeAction();
    const stateWithFourTrees = applyActions(initialState, [createTree, createTree]);

    const toggledState = SkeletonTracingReducer(stateWithFourTrees, toggleInactiveTreesAction());

    let trees = enforceSkeletonTracing(toggledState.annotation).trees;
    expect(trees.getOrThrow(1).isVisible).toBe(false);
    expect(trees.getOrThrow(2).isVisible).toBe(false);
    expect(trees.getOrThrow(3).isVisible).toBe(false);
    expect(trees.getOrThrow(4).isVisible).toBe(true);

    const retoggledState = SkeletonTracingReducer(toggledState, toggleInactiveTreesAction());
    trees = enforceSkeletonTracing(retoggledState.annotation).trees;

    expect(trees.getOrThrow(1).isVisible).toBe(true);
    expect(trees.getOrThrow(2).isVisible).toBe(true);
    expect(trees.getOrThrow(3).isVisible).toBe(true);
    expect(trees.getOrThrow(4).isVisible).toBe(true);
  });

  it("should toggle all trees", () => {
    const createTree = createTreeAction();
    const stateWithFourTrees = applyActions(initialState, [createTree, createTree]);

    const toggledState = SkeletonTracingReducer(stateWithFourTrees, toggleAllTreesAction());

    let trees = enforceSkeletonTracing(toggledState.annotation).trees;
    expect(trees.getOrThrow(1).isVisible).toBe(false);
    expect(trees.getOrThrow(2).isVisible).toBe(false);
    expect(trees.getOrThrow(3).isVisible).toBe(false);
    expect(trees.getOrThrow(4).isVisible).toBe(false);

    const retoggledState = SkeletonTracingReducer(toggledState, toggleInactiveTreesAction());
    trees = enforceSkeletonTracing(retoggledState.annotation).trees;

    expect(trees.getOrThrow(1).isVisible).toBe(true);
    expect(trees.getOrThrow(2).isVisible).toBe(true);
    expect(trees.getOrThrow(3).isVisible).toBe(true);
    expect(trees.getOrThrow(4).isVisible).toBe(true);
  });

  it("should toggle inactive trees when a group is active", () => {
    const createTree = createTreeAction();
    const stateWithFourTrees = applyActions(initialState, [
      createTree,
      createTree,

      setTreeGroupsAction([{ groupId: 1, name: "Some Group", children: [] }]),

      setTreeGroupAction(1, 1),
      setTreeGroupAction(1, 2),
      setTreeGroupAction(1, 3),
    ]);

    const toggledState = SkeletonTracingReducer(stateWithFourTrees, toggleInactiveTreesAction());

    let trees = enforceSkeletonTracing(toggledState.annotation).trees;
    expect(trees.getOrThrow(1).isVisible).toBe(false);
    expect(trees.getOrThrow(2).isVisible).toBe(false);
    expect(trees.getOrThrow(3).isVisible).toBe(false);
    expect(trees.getOrThrow(4).isVisible).toBe(true);

    const retoggledState = SkeletonTracingReducer(toggledState, toggleInactiveTreesAction());
    trees = enforceSkeletonTracing(retoggledState.annotation).trees;

    expect(trees.getOrThrow(1).isVisible).toBe(true);
    expect(trees.getOrThrow(2).isVisible).toBe(true);
    expect(trees.getOrThrow(3).isVisible).toBe(true);
    expect(trees.getOrThrow(4).isVisible).toBe(true);
  });

  it("should add a new tree with addTreesAndGroupsAction (without relabeling)", () => {
    expect(initialState.annotation.skeleton?.trees.size()).toBe(2);
    let ids: number[] | null = null;
    const treeIdCallback = (_ids: number[]) => (ids = _ids);

    const state = applyActions(initialState, [
      // Id-relabeling is only done if the skeleton is not empty.
      // Therefore, delete the two existing trees so that the new tree will
      // be added without id-relabeling.
      deleteTreeAction(1),
      deleteTreeAction(2),
      addTreesAndGroupsAction(
        new MutableTreeMap([[4, { ...initialTreeOne, treeId: 4 }]]),
        [],
        treeIdCallback,
      ),
    ]);

    // The original tree id 4 should have survived.
    expect(ids).toEqual([4]);
    expect(state.annotation.skeleton?.trees.size()).toBe(1);
    expect(state.annotation.skeleton?.trees.getNullable(4)).toBeDefined();
    expect(state.annotation.skeleton?.trees.getNullable(4)?.treeId).toBe(4);
  });

  it("should add a new tree with addTreesAndGroupsAction (with id relabeling)", () => {
    expect(initialState.annotation.skeleton?.trees.size()).toBe(2);
    let ids: number[] | null = null;
    const treeIdCallback = (_ids: number[]) => (ids = _ids);

    const state = applyActions(initialState, [
      addTreesAndGroupsAction(
        new MutableTreeMap([[8_000_000, { ...initialTreeOne, treeId: 8_000_000 }]]),
        [],
        treeIdCallback,
      ),
    ]);

    // The original tree id 8_000_000 should have been changed to the next free id (3).
    expect(ids).toEqual([3]);
    expect(state.annotation.skeleton?.trees.size()).toBe(3);
    expect(state.annotation.skeleton?.trees.getNullable(3)).toBeDefined();
    expect(state.annotation.skeleton?.trees.getNullable(3)?.treeId).toBe(3);
    expect(state.annotation.skeleton?.trees.getNullable(8_000_000)).toBeUndefined();
  });
});

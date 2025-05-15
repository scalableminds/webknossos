import _ from "lodash";
import update from "immutability-helper";
import ChainReducer from "test/helpers/chainReducer";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "viewer/model/edge_collection";
import { describe, it, expect } from "vitest";
import { MISSING_GROUP_ID } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import type { WebknossosState, Node, Tree, MutableNode } from "viewer/store";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import type { Action } from "viewer/model/actions/actions";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  initialState as defaultState,
  initialSkeletonTracing,
} from "test/fixtures/hybridtracing_object";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import * as SkeletonTracingActions from "viewer/model/actions/skeletontracing_actions";

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

describe("SkeletonTracing", () => {
  it("should add a new node", () => {
    const action = SkeletonTracingActions.createNodeAction(position, null, rotation, viewport, mag);
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
    const maxNodeId = _.max(Array.from(newSkeletonTracing.trees.getOrThrow(1).nodes.keys()));

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
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    const maxNodeId = _.max(
      newSkeletonTracing.trees
        .values()
        .flatMap((tree) => tree.nodes.map((node: Node) => node.id))
        .toArray(),
    );

    expect(maxNodeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toEqual(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).edges.size()).toEqual(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).edges.asArray()).toEqual([
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
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    const maxNodeId = _.max(
      newSkeletonTracing.trees
        .values()
        .flatMap((tree) => tree.nodes.map((node) => node.id))
        .toArray(),
    );

    expect(maxNodeId).toBe(3);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toEqual(1);
    expect(newSkeletonTracing.trees.getOrThrow(2).nodes.size()).toEqual(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toEqual(2);
    expect(newSkeletonTracing.trees.getOrThrow(2).edges.size()).toEqual(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.asArray()).toEqual([
      {
        source: 2,
        target: 3,
      },
    ]);
  });

  it("shouldn't delete the tree if 'delete node' is initiated for an empty tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
    const newStateA = SkeletonTracingReducer(initialState, createTreeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateA).toEqual(newStateB);
  });

  it("should delete the tree if 'delete node as user' is initiated for an empty tree", () => {
    const { createTreeAction, deleteNodeAsUserAction } = SkeletonTracingActions;
    const newState = ChainReducer<WebknossosState, Action>(initialStateWithActiveTreeId2)
      .apply(SkeletonTracingReducer, createTreeAction())
      .apply(SkeletonTracingReducer, (currentState: WebknossosState) =>
        deleteNodeAsUserAction(currentState),
      )
      .unpack();

    expect(newState).toEqual(initialStateWithActiveTreeId2);
  });

  it("should delete a node from a tree", () => {
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

    expect(newStateB).not.toBe(newState);
    expect(newStateB).not.toBe(newStateA);
    expect(newStateA).not.toBe(newState);
    expect(newStateB).toEqual(newState);
  });

  it("should delete respective comments and branchpoints when deleting a node from a tree", () => {
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
    const nodes = enforceSkeletonTracing(newStateC.annotation).trees.getOrThrow(1).nodes;
    expect(nodes.chunks.length).toBe(1);
    expect(nodes.chunks[0].size).toBe(0);
    nodes.chunks = [];
    expect(newStateC).toEqual(initialState);
  });

  it("should not delete tree when last node is deleted from the tree", () => {
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

    const emptySkeletonTracing = enforceSkeletonTracing(emptyTreeState.annotation);
    const newState = ChainReducer<WebknossosState, Action>(emptyTreeState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, deleteNodeAction)
      .apply(SkeletonTracingReducer, deleteNodeAction)
      .unpack();

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
            $set: new DiffableMap<number, Tree>([
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
    const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

    // Delete the second node
    const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
    const state1 = SkeletonTracingReducer(state0, deleteNodeAction);
    const newTrees = enforceSkeletonTracing(state1.annotation).trees;
    expect(Object.keys(newTrees).length).toBe(4);
    expect(newTrees.getOrThrow(0).nodes.getOrThrow(0).id).toBe(0);
    expect(newTrees.getOrThrow(0).comments.length).toBe(1);
    expect(newTrees.getOrThrow(0).comments[0].nodeId).toBe(0);
    expect(newTrees.getOrThrow(2).nodes.getOrThrow(2).id).toBe(2);
    expect(newTrees.getOrThrow(1).nodes.getOrThrow(4).id).toBe(4);
    expect(newTrees.getOrThrow(3).nodes.getOrThrow(7).id).toBe(7);
    expect(newTrees.getOrThrow(3).branchPoints[0].nodeId).toBe(7);
  });

  it("should not delete an edge if the two nodes are not neighbors", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(0, 3);
    // Create a couple of nodes
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .unpack();

    const newStateA = SkeletonTracingReducer(newState, deleteEdgeAction);
    expect(newState).toEqual(newStateA);
  });

  it("should not delete an edge if the both nodes are identical", () => {
    const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(0, 0);
    const newStateA = SkeletonTracingReducer(initialState, deleteEdgeAction);

    expect(initialState).toEqual(newStateA);
  });

  it("should not delete any edge if the two nodes are in different trees", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .unpack();

    const newStateA = SkeletonTracingReducer(newState, deleteEdgeAction);
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
            $set: new DiffableMap<number, Tree>([
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

    const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(1);
    const deleteEdgeAction = SkeletonTracingActions.deleteEdgeAction(1, 2);
    const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
    const state1 = SkeletonTracingReducer(state0, deleteEdgeAction);

    const newTrees = enforceSkeletonTracing(state1.annotation).trees;
    expect(Object.keys(newTrees).length).toBe(3);
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
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should set a new active node in a different tree", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });
  it("should set a new node radius", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.getOrThrow(1).radius).toEqual(newRadius);
  });
  it("should create a branchpoint", () => {
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
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
    // create a branchpoint in a tree without any nodes
    const newState = SkeletonTracingReducer(initialState, createBranchPointAction);
    expect(newState).toBe(initialState);
    expect(newState).toBe(initialState);
  });
  it("shouldn't create a branchpoint without the correct permissions", () => {
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
      annotation: { restrictions: { branchPointsAllowed: { $set: false } } },
    });

    let newState = SkeletonTracingReducer(startState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
  });
  it("shouldn't create more branchpoints than nodes", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });
  it("should delete specific selected branchpoint", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(2);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });
  it("should delete several branchpoints", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });
  it("shouldn't delete more branchpoints than available", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(1);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });
  it("should delete a branchpoint from a different tree", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).branchPoints.length).toBe(0);
  });
  it("should delete a branchpoint from another tree than the active one", () => {
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
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).branchPoints.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).branchPoints.length).toBe(0);
    // as the branchpoint was in the third tree, the third tree should be active again
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });
  it("should add a new tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const newState = SkeletonTracingReducer(initialState, createTreeAction);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(_.size(newSkeletonTracing.trees)).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).treeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
    expect(newSkeletonTracing.trees.getOrThrow(3)).toEqual(
      expect.objectContaining({
        comments: [],
        branchPoints: [],
        nodes: new DiffableMap(),
        treeId: 3,
        color: [0.8509803921568627, 0.5215686274509804, 0.07058823529411765],
      }),
    );
  });
  it("should add a several new trees", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    // create three trees
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(5);
    expect(
      _.max(
        newSkeletonTracing.trees
          .values()
          .map((tree) => tree.treeId)
          .toArray(),
      ),
    ).toBe(5);
    expect(newSkeletonTracing.activeTreeId).toBe(5);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
  });

  it("should delete a new tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();

    // create a tree and delete it again
    const newState = ChainReducer<WebknossosState, Action>(initialStateWithActiveTreeId2)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .unpack();

    expect(newState).not.toBe(initialStateWithActiveTreeId2);
    expect(newState).toEqual(initialStateWithActiveTreeId2);
  });

  it("should delete several trees", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();

    // create trees and delete them
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(_.size(newSkeletonTracing.trees)).toBe(0);
    expect(newSkeletonTracing.trees).not.toBe(initialSkeletonTracing.trees);
  });

  it("should delete several trees at once", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteTreesAction = SkeletonTracingActions.deleteTreesAction([1, 2, 3, 4]);
    // create trees and delete them
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, deleteTreesAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(_.size(newSkeletonTracing.trees)).toBe(0);
    expect(newSkeletonTracing.trees).not.toBe(initialSkeletonTracing.trees);
  });

  it("should set a new active tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(2);
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, setActiveTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(2);
    expect(newSkeletonTracing.activeNodeId).toBe(null);
  });

  it("should set a different active tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(3);

    // create a second tree with two nodes and set it active
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, setActiveTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(2);
  });

  it("shouldn't set a new active tree for unknown tree ids", () => {
    const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(10);
    const newState = SkeletonTracingReducer(initialState, setActiveTreeAction);

    expect(newState).toBe(initialState);
  });

  it("should merge two trees", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, mergeTreesAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(_.size(newSkeletonTracing.trees)).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(4);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.asArray()).toEqual([
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
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 3);
    // create a node in first tree, then create a second tree with three nodes and merge them
    const testState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .unpack();

    const newState = SkeletonTracingReducer(testState, mergeTreesAction);
    expect(newState).toBe(testState);
  });

  it("should merge two trees with comments and branchPoints", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
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
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.size()).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(4);
    expect(newSkeletonTracing.trees.getOrThrow(3).edges.asArray()).toEqual([
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

    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );

    // Create a new agglomerate tree with 3 nodes; then add two nodes to the first tree of type default.
    const newState = ChainReducer<WebknossosState, Action>(initialStateWithAgglomerateNodes)
      // Add two more nodes to tree with id 1.
      .apply(SkeletonTracingReducer, createNodeAction) // For tree 1
      .apply(SkeletonTracingReducer, createNodeAction) // For tree 1
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(_.size(newSkeletonTracing.trees)).toBe(3);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.size()).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.size()).toBe(3);

    // Trying to merge those trees should fail as they have a different type.
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(5, 2);
    const stateAfterMerge = SkeletonTracingReducer(newState, mergeTreesAction);
    expect(stateAfterMerge).toBe(newState);
  });

  it("should rename the active tree", () => {
    const newName = "SuperTestName";
    const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName);
    const newState = SkeletonTracingReducer(initialState, setTreeNameAction);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).toBe(newName);
  });

  it("should rename the active tree to a default name", () => {
    const setTreeNameAction = SkeletonTracingActions.setTreeNameAction();
    const newState = SkeletonTracingReducer(initialState, setTreeNameAction);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).toBe("Tree001");
  });

  it("should increase the activeTreeId", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const setActiveTreeAction = SkeletonTracingActions.setActiveTreeAction(1);
    const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction();

    // create a second tree, set first tree active then increase activeTreeId
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, setActiveTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(2);
  });

  it("should decrease the activeTreeId", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction(false);

    // create a second tree then decrease activeTreeId
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should wrap around when decreasing the activeTreeId below 1", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction(false);

    // create a second tree then decrease activeTreeId twice
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });

  it("should be able to select next tree when tree ids are not consecutive", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteTreeAction = SkeletonTracingActions.deleteTreeAction(3);
    const selectNextTreeAction = SkeletonTracingActions.selectNextTreeAction();

    // create a second tree then decrease activeTreeId twice
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .apply(SkeletonTracingReducer, selectNextTreeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.activeTreeId).toBe(4);
  });

  it("should shuffle the color of a specified tree", () => {
    const shuffleTreeColorAction = SkeletonTracingActions.shuffleTreeColorAction(1);
    const newState = SkeletonTracingReducer(initialState, shuffleTreeColorAction);
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).color).not.toEqual([23, 23, 23]);
  });

  it("should create a comment for the active node", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
  });

  it("shouldn't create a comments if there is no active node", () => {
    const commentText = "Wow such test comment";
    const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
    const newState = SkeletonTracingReducer(initialState, createCommentAction);
    expect(newState).toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
  });

  it("shouldn't create more than one comment for the active node", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
  });

  it("should create comments for several nodes", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, SkeletonTracingActions.createCommentAction(commentText1))
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, SkeletonTracingActions.createCommentAction(commentText2))
      .unpack();
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
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const createCommentAction = SkeletonTracingActions.createCommentAction(commentText);
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(2).comments.length).toBe(0);
    expect(newSkeletonTracing.trees.getOrThrow(3).comments.length).toBe(1);
  });

  it("should delete a comment for a node", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, deleteCommentAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(0);
  });

  it("should only delete the comment for the active node", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, deleteCommentAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
  });

  it("should add a node in a specified tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
      3,
    );

    // create a few trees and add a node to a specific one
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .unpack();
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);

    expect(newSkeletonTracing.trees.getOrThrow(3).nodes.getOrThrow(1)).toBeTruthy();
    expect(newSkeletonTracing.activeTreeId).toBe(3);
    expect(newSkeletonTracing.activeNodeId).toBe(1);
  });

  it("should delete a specified node (1/2)", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(2, 1);

    // create three nodes and delete a specific one
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, deleteNodeAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.has(2)).toBeFalsy();

    // tree is split
    expect(newSkeletonTracing.trees.getOrThrow(2)).toBeTruthy();
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should delete a specified node (2/2)", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction(2);

    // create three nodes and delete a specific one
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, deleteNodeAction)
      .unpack();

    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).nodes.has(2)).toBeFalsy();

    // tree is split
    expect(newSkeletonTracing.trees.getOrThrow(2)).toBeTruthy();
    expect(newSkeletonTracing.activeNodeId).toBe(1);
    expect(newSkeletonTracing.activeTreeId).toBe(1);
  });

  it("should create a branchpoint for a specified node (1/2)", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(2, 1);

    // create some nodes and then set a specific one as branchpoint
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createBranchPointAction)
      .unpack();
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
  });

  it("should create a branchpoint for a specified node (2/2)", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(2, 1);

    // create some nodes and then set a specific one as branchpoint
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createBranchPointAction)
      .unpack();

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).branchPoints[0].nodeId).toBe(2);
  });

  it("should delete a specified tree", () => {
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const deleteTreeAction = SkeletonTracingActions.deleteTreeAction(2);

    // create some trees and delete a specific one
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, deleteTreeAction)
      .unpack();

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(2)).toBeFalsy();
    expect(newSkeletonTracing.trees.getOrThrow(3)).toBeTruthy();
    expect(newSkeletonTracing.activeTreeId).toBe(3);
  });

  it("should rename a specified tree", () => {
    const newName = "SuperTestName";
    const createTreeAction = SkeletonTracingActions.createTreeAction();
    const setTreeNameAction = SkeletonTracingActions.setTreeNameAction(newName, 2);

    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, createTreeAction)
      .apply(SkeletonTracingReducer, setTreeNameAction)
      .unpack();

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(2).name).toBe(newName);
    expect(newSkeletonTracing.trees.getOrThrow(1).name).not.toBe(newName);
    expect(newSkeletonTracing.trees.getOrThrow(3).name).not.toBe(newName);
  });

  it("should create a comment for a specified node", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .unpack();

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].content).toBe(commentText);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(2);
  });

  it("should delete a comment for a specified node (1/2)", () => {
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
    const newState = ChainReducer<WebknossosState, Action>(initialState)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, createNodeAction)
      .apply(SkeletonTracingReducer, createCommentAction)
      .apply(SkeletonTracingReducer, deleteCommentAction)
      .unpack();

    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments.length).toBe(2);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[0].nodeId).toBe(1);
    expect(newSkeletonTracing.trees.getOrThrow(1).comments[1].nodeId).toBe(3);
  });

  it("should change the color of a specified tree", () => {
    const colorIndex = 10;
    const newState = SkeletonTracingReducer(
      initialState,
      SkeletonTracingActions.setTreeColorIndexAction(1, colorIndex),
    );
    expect(newState).not.toBe(initialState);

    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    expect(newSkeletonTracing.trees.getOrThrow(1).color).not.toEqual([23, 23, 23]);
  });
});

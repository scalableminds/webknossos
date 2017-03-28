/**
 * skeletontracing_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import _ from "lodash";
import mock from "mock-require";
import * as SkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import update from "immutability-helper";

mock.stopAll();
mock("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mock("libs/window", { confirm: () => true });
const SkeletonTracingReducer = mock.reRequire("oxalis/model/reducers/skeletontracing_reducer").default;

describe("SkeletonTracing", () => {
  const initialState = {
    dataset: {
      scale: [5, 5, 5],
    },
    userConfiguration: null,
    datasetConfiguration: null,
    task: {
      id: 1,
    },
    tracing: {
      type: "skeleton",
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

  it("should add a new node", () => {
    const action = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const newState = SkeletonTracingReducer(initialState, action);

    expect(newState).not.toBe(initialState);

    // This should be unchanged / sanity check
    expect(newState.tracing.name).toBe(initialState.tracing.name);
    expect(newState.tracing.activeTreeId).toBe(initialState.tracing.activeTreeId);
    expect(newState.tracing.trees[0].branchPoints).toBe(initialState.tracing.trees[0].branchPoints);
    expect(newState.tracing.trees[0].treeId).toBe(initialState.tracing.trees[0].treeId);
    expect(newState.tracing.trees[0].name).toBe(initialState.tracing.trees[0].name);

    // This should be changed
    const maxNodeId = _.max(Object.keys(newState.tracing.trees[0].nodes));

    expect(maxNodeId).toBe("0");
    expect(newState.tracing.activeNodeId).toBe(0);
    expect(_.size(newState.tracing.trees[0].edges)).toEqual(0);
    expect(newState.tracing.trees[0].nodes[0]).toEqual(jasmine.objectContaining({
      position,
      rotation,
      viewport,
      resolution,
      id: 0,
      radius: 50,
    }));
  });

  it("should add a several nodes", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));

    // create three nodes
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);

    expect(newState).not.toBe(initialState);
    const maxNodeId = _.max(_.flatMap(newState.tracing.trees, tree => _.map(tree.nodes, node => node.id)));
    expect(maxNodeId).toBe(2);
    expect(newState.tracing.activeNodeId).toBe(2);
    expect(_.size(newState.tracing.trees[0].nodes)).toEqual(3);
    expect(newState.tracing.trees[0].edges.length).toEqual(2);
    expect(newState.tracing.trees[0].edges).toEqual([
      { source: 0, target: 1 },
      { source: 1, target: 2 },
    ]);
  });

  it("should add nodes to a different tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());

    // add a node to inital tree, then create a second tree and add two nodes
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);

    expect(newState).not.toBe(initialState);
    const maxNodeId = _.max(_.flatMap(newState.tracing.trees, tree => _.map(tree.nodes, node => node.id)));
    expect(maxNodeId).toBe(2);
    expect(newState.tracing.activeTreeId).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(2);
    expect(_.size(newState.tracing.trees[0].nodes)).toEqual(1);
    expect(_.size(newState.tracing.trees[1].nodes)).toEqual(2);
    expect(newState.tracing.trees[0].edges.length).toEqual(0);
    expect(newState.tracing.trees[1].edges).toEqual([
      { source: 1, target: 2 },
    ]);
  });

  it("shouldn't delete a node from an empty tree", () => {
    const action = addTimestamp(SkeletonTracingActions.deleteNodeAction());
    const newState = SkeletonTracingReducer(initialState, action);

    expect(newState).toBe(initialState);
    expect(newState).toEqual(initialState);
  });

  it("should delete a node from a tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());

    // Add two nodes, then delete one
    const newState = SkeletonTracingReducer(initialState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, createNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).not.toBe(newState);
    expect(newStateB).not.toBe(newStateA);
    expect(newStateA).not.toBe(newState);
    expect(newStateB).toEqual(newState);
  });

  it("should delete several nodes from a tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());

    // Add one node, then delete two times
    const newState = SkeletonTracingReducer(initialState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, deleteNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).not.toBe(newState);
    expect(newStateA).not.toBe(newState);
    expect(newStateB).toBe(newStateA);
    expect(Object.keys(newStateB.tracing.trees[1].nodes).length).toEqual(0);
  });

  it("should delete nodes and split the tree", () => {
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
      { tracing: { trees: { $set: {
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


    const setActiveNodeAction = addTimestamp(SkeletonTracingActions.setActiveNodeAction(1));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());

    // Add three nodes node, then delete the second one
    const state0 = SkeletonTracingReducer(state, setActiveNodeAction);
    const state1 = SkeletonTracingReducer(state0, deleteNodeAction);

    const newTrees = state1.tracing.trees;

    expect(Object.keys(newTrees).length).toBe(4);
    expect(newTrees[0].nodes[0].id).toBe(0);
    expect(newTrees[0].comments.length).toBe(1);
    expect(newTrees[0].comments[0].node).toBe(0);
    expect(newTrees[1].nodes[4].id).toBe(4);

    expect(newTrees[2].nodes[2].id).toBe(2);
    expect(newTrees[3].nodes[7].id).toBe(7);
    expect(newTrees[3].branchPoints[0].id).toBe(7);
  });

  it("should set a new active node", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeAction = addTimestamp(SkeletonTracingActions.setActiveNodeAction(0));

    // Create two nodes, then set first one active
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeNodeId).toBe(0);
    expect(newState.tracing.activeTreeId).toBe(0);
  });

  it("should set a new active node in a different tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeAction = addTimestamp(SkeletonTracingActions.setActiveNodeAction(1));

    // Create one node in the first tree, then set create second tree with two nodes
    // Then set first node of second tree active
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeNodeId).toBe(1);
    expect(newState.tracing.activeTreeId).toBe(1);
  });

  it("should set a new node radius", () => {
    const newRadius = 10;
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeRadiusAction = addTimestamp(SkeletonTracingActions.setActiveNodeRadiusAction(newRadius));

    // Create a node and change its readius
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeRadiusAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].nodes[0].radius).toEqual(newRadius);
  });

  it("should create a branchpoint", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create a single node and then set it as branchpoint
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.tracing.trees[0].branchPoints[0]).toEqual(jasmine.objectContaining({
      id: 0,
    }));
  });

  it("shouldn't create a branchpoint in an empty tree", () => {
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create a branchpoint in a tree without any nodes
    const newState = SkeletonTracingReducer(initialState, createBranchPointAction);
    expect(newState).toBe(initialState);
    expect(newState).toBe(initialState);
  });

  it("shouldn't create a branchpoint without the correct permissions", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

    // create a node and set a branch point in tracing without the correct permissions
    const startState = _.cloneDeep(initialState);
    startState.tracing.restrictions.branchPointsAllowed = false;

    let newState = SkeletonTracingReducer(startState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toEqual(0);
  });

  it("shouldn't create more branchpoints than nodes", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create one node and set it as branchpoint three times
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.tracing.trees[0].branchPoints[0]).toEqual(jasmine.objectContaining({
      id: 0,
    }));
  });

  it("should delete a branchpoint", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create one node and set it as branchpoint, create a second node and jump back to branchpoint
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.tracing.trees[0].nodes)).toBe(2);
    expect(newState.tracing.activeNodeId).toBe(0);
    expect(newState.tracing.activeTreeId).toBe(0);
  });

  it("should delete several branchpoints", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.tracing.trees[0].nodes)).toBe(2);
    expect(newState.tracing.activeNodeId).toBe(0);
    expect(newState.tracing.activeTreeId).toBe(0);
  });

  it("shouldn't delete more branchpoints than available", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.tracing.trees[0].nodes)).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(0);
    expect(newState.tracing.activeTreeId).toBe(0);
  });

  it("should delete a branchpoint from a different tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create a new tree, add a node, set it as branchpoint twice then delete the branchpoint
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toBe(0);
    expect(newState.tracing.trees[1].branchPoints.length).toBe(0);
  });

  it("should add a new tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const newState = SkeletonTracingReducer(initialState, createTreeAction);

    expect(newState).not.toBe(initialState);
    expect(_.size(newState.tracing.trees)).toBe(2);
    expect(newState.tracing.trees[1].treeId).toBe(1);
    expect(newState.tracing.activeTreeId).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(null);
    expect(newState.tracing.trees[1]).toEqual(jasmine.objectContaining({
      comments: [],
      branchPoints: [],
      nodes: {},
      treeId: 1,
      color: [0, 0.29179606750063036, 1],
      // name: ...
    }));
  });

  it("should add a several new trees", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());

    // create three trees
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);

    expect(newState).not.toBe(initialState);
    expect(_.size(newState.tracing.trees)).toBe(4);
    expect(_.max(_.map(newState.tracing.trees, "treeId"))).toBe(3);
    expect(newState.tracing.activeTreeId).toBe(3);
    expect(newState.tracing.activeNodeId).toBe(null);
  });

  it("should delete a new tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());

    // create a tree and delete it again
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState).toEqual(initialState);
  });

  it("should delete several trees", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());

    // create a tree and delete it three times
    // there should always be at least one tree in a tracing
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);

    expect(newState).not.toBe(initialState);
    expect(_.size(newState.tracing.trees)).toEqual(1);
    expect(newState.tracing.trees).not.toBe(initialState.tracing.trees);
    expect(Object.keys(newState.tracing.trees).length).toBe(1);
  });

  it("should set a new active tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(1));
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, setActiveTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeTreeId).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(null);
  });

  it("should set a different active tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(1));

    // create a second tree with two nodes and set it active
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeTreeId).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(1);
  });

  it("shouldn't set a new active tree for unknown tree ids", () => {
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(10));
    const newState = SkeletonTracingReducer(initialState, setActiveTreeAction);

    expect(newState).toBe(initialState);
  });

  it("should merge two trees", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(0, 2));

    // create a node in first tree, then create a second tree with three nodes and merge them
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, mergeTreesAction);

    expect(newState).not.toBe(initialState);
    expect(_.size(newState.tracing.trees)).toBe(1);
    expect(_.size(newState.tracing.trees[1].nodes)).toBe(4);
    expect(newState.tracing.trees[1].edges).toEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 0, target: 2 },
    ]);
  });

  it("should merge two trees with comments and branchPoints", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(0, 2));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction("foo"));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

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

    expect(newState).not.toBe(initialState);
    expect(_.size(newState.tracing.trees)).toBe(1);
    expect(_.size(newState.tracing.trees[1].nodes)).toBe(4);
    expect(newState.tracing.trees[1].edges).toEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 0, target: 2 },
    ]);
    expect(newState.tracing.trees[1].comments.length).toBe(2);
    expect(newState.tracing.trees[1].branchPoints.length).toBe(1);
  });

  it("should rename the active tree", () => {
    const newName = "SuperTestName";
    const setTreeNameAction = addTimestamp(SkeletonTracingActions.setTreeNameAction(newName));
    const newState = SkeletonTracingReducer(initialState, setTreeNameAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].name).toEqual(newName);
  });

  it("should rename the active tree to a default name", () => {
    const setTreeNameAction = addTimestamp(SkeletonTracingActions.setTreeNameAction());
    const newState = SkeletonTracingReducer(initialState, setTreeNameAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].name).toEqual("Tree000");
  });

  it("should increase the activeTreeId", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(0));
    const selectNextTreeAction = addTimestamp(SkeletonTracingActions.selectNextTreeAction());

    // create a second tree, set first tree active then increase activeTreeId
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, setActiveTreeAction);
    newState = SkeletonTracingReducer(newState, selectNextTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeTreeId).toBe(1);
  });

  it("should decrease the activeTreeId", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const selectNextTreeAction = addTimestamp(SkeletonTracingActions.selectNextTreeAction(false));

    // create a second tree then decrease activeTreeId
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, selectNextTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.activeTreeId).toBe(0);
  });

  it("should shuffle the color of a specified tree", () => {
    const shuffleTreeColorAction = addTimestamp(SkeletonTracingActions.shuffleTreeColorAction(0));
    const newState = SkeletonTracingReducer(initialState, shuffleTreeColorAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].color).not.toEqual([23, 23, 23]);
  });

  it("should create a comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));

    // create a single node with a comment
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(1);
    expect(newState.tracing.trees[0].comments[0].content).toEqual(commentText);
    expect(newState.tracing.trees[0].comments[0].node).toEqual(0);
  });

  it("shouldn't create a comments if there is no active node", () => {
    const commentText = "Wow such test comment";
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const newState = SkeletonTracingReducer(initialState, createCommentAction);

    expect(newState).toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(0);
  });

  it("shouldn't create more than one comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));

    // create a node and add the same comment three times
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(1);
  });

  it("should create comments for several nodes", () => {
    const commentText1 = "Wow such test comment";
    const commentText2 = "Amaze test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));

    // create two nodes with a different comment each
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, addTimestamp(SkeletonTracingActions.createCommentAction(commentText1)));
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, addTimestamp(SkeletonTracingActions.createCommentAction(commentText2)));

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(2);
    expect(newState.tracing.trees[0].comments[0].content).toEqual(commentText1);
    expect(newState.tracing.trees[0].comments[0].node).toEqual(0);
    expect(newState.tracing.trees[0].comments[1].content).toEqual(commentText2);
    expect(newState.tracing.trees[0].comments[1].node).toEqual(1);
  });

  it("should create comments for a different tree", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());

    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(0);
    expect(newState.tracing.trees[1].comments.length).toEqual(1);
  });

  it("should delete a comment for a node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const deleteCommentAction = addTimestamp(SkeletonTracingActions.deleteCommentAction());

    // create a node with a comment, then delete it
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, deleteCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(0);
  });

  it("should only delete the comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const deleteCommentAction = addTimestamp(SkeletonTracingActions.deleteCommentAction());

    // create two nodes with a comment each and delete the comment for the last node
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, deleteCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(1);
    expect(newState.tracing.trees[0].comments[0].node).toEqual(0);
    expect(newState.tracing.trees[0].comments[0].content).toEqual(commentText);
  });

  it("should add a node in a specified tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution, 1));

    // create a few trees and add a node to a specific one
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[1].nodes[0]).not.toBeUndefined();
    expect(newState.tracing.activeTreeId).toBe(1);
    expect(newState.tracing.activeNodeId).toBe(0);
  });

  it("should delete a specified node (1/2)", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction(1, 0));

    // create three nodes and delete a specific one
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, deleteNodeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].nodes[1]).toBeUndefined();
    // tree is split
    expect(newState.tracing.trees[1]).not.toBeUndefined();
    expect(newState.tracing.activeNodeId).toBe(2);
    expect(newState.tracing.activeTreeId).toBe(1);
  });

  it("should delete a specified node (2/2)", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction(1));

    // create three nodes and delete a specific one
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, deleteNodeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].nodes[1]).toBeUndefined();
    // tree is split
    expect(newState.tracing.trees[1]).not.toBeUndefined();
    expect(newState.tracing.activeNodeId).toBe(2);
    expect(newState.tracing.activeTreeId).toBe(1);
  });

  it("should create a branchpoint for a specified node (1/2)", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction(1, 0));

    // create some nodes and then set a specific one as branchpoint
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.tracing.trees[0].branchPoints[0].id).toEqual(1);
  });

  it("should create a branchpoint for a specified node (2/2)", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction(1));

    // create some nodes and then set a specific one as branchpoint
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.tracing.trees[0].branchPoints[0].id).toEqual(1);
  });

  it("should delete a specified tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction(1));

    // create some trees and delete a specific one
    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[1]).toBeUndefined();
    expect(newState.tracing.trees[2]).not.toBeUndefined();
    expect(newState.tracing.activeTreeId).toBe(2);
  });

  it("should rename a specified tree", () => {
    const newName = "SuperTestName";
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const setTreeNameAction = addTimestamp(SkeletonTracingActions.setTreeNameAction(newName, 1));

    let newState = SkeletonTracingReducer(initialState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, setTreeNameAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[1].name).toEqual(newName);
    expect(newState.tracing.trees[0].name).not.toEqual(newName);
    expect(newState.tracing.trees[2].name).not.toEqual(newName);
  });

  it("should create a comment for a specified node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText, 1));

    // create a few nodes and adds one comment
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(1);
    expect(newState.tracing.trees[0].comments[0].content).toEqual(commentText);
    expect(newState.tracing.trees[0].comments[0].node).toEqual(1);
  });
  it("should delete a comment for a specified node (1/2)", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const deleteCommentAction = addTimestamp(SkeletonTracingActions.deleteCommentAction(1));

    // create nodes with comments, then delete a specific comment
    let newState = SkeletonTracingReducer(initialState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, deleteCommentAction);

    expect(newState).not.toBe(initialState);
    expect(newState.tracing.trees[0].comments.length).toEqual(2);
    expect(newState.tracing.trees[0].comments[0].node).toEqual(0);
    expect(newState.tracing.trees[0].comments[1].node).toEqual(2);
  });
});

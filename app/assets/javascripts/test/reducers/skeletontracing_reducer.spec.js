/**
 * skeletontracing_reducer.spec.js
 * @flow
 */

/* eslint-disable no-useless-computed-key */
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import _ from "lodash";
import mock from "mock-require";
import ScaleInfo from "oxalis/model/scaleinfo";
import * as SkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";

mock.stopAll();
mock("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mock("libs/window", { confirm: () => true });
const SkeletonTracingReducer = mock.reRequire("oxalis/model/reducers/skeletontracing_reducer").default;

describe("SkeletonTracing", () => {
  const initalState = {
    dataset: null,
    userConfiguration: null,
    datasetConfiguration: null,
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

  beforeAll(() => {
    // needed for default node radius
    ScaleInfo.initialize([5]);
  });

  it("should add a new node", () => {
    const action = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const newState = SkeletonTracingReducer(initalState, action);

    // This should be unchanged / sanity check
    expect(newState.skeletonTracing.name).toBe(initalState.skeletonTracing.name);
    expect(newState.skeletonTracing.activeTreeId).toBe(initalState.skeletonTracing.activeTreeId);
    expect(newState.skeletonTracing.trees[0].branchPoints).toBe(initalState.skeletonTracing.trees[0].branchPoints);
    expect(newState.skeletonTracing.trees[0].treeId).toBe(initalState.skeletonTracing.trees[0].treeId);
    expect(newState.skeletonTracing.trees[0].name).toBe(initalState.skeletonTracing.trees[0].name);

    // This should be changed
    const maxNodeId = _.max(Object.keys(newState.skeletonTracing.trees[0].nodes));

    expect(maxNodeId).toBe("0");
    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(_.size(newState.skeletonTracing.trees[0].edges)).toEqual(0);
    expect(newState.skeletonTracing.trees[0].nodes[0]).toEqual(jasmine.objectContaining({
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
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);

    const maxNodeId = _.max(_.flatMap(newState.skeletonTracing.trees, tree => _.map(tree.nodes, node => node.id)));
    expect(maxNodeId).toBe(2);
    expect(newState.skeletonTracing.activeNodeId).toBe(2);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toEqual(3);
    expect(newState.skeletonTracing.trees[0].edges.length).toEqual(2);
    expect(newState.skeletonTracing.trees[0].edges).toEqual([
      { source: 0, target: 1 },
      { source: 1, target: 2 },
    ]);
  });

  it("should add nodes to a different tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());

    // add a node to inital tree, then create a second tree and add two nodes
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);

    const maxNodeId = _.max(_.flatMap(newState.skeletonTracing.trees, tree => _.map(tree.nodes, node => node.id)));
    expect(maxNodeId).toBe(2);
    expect(newState.skeletonTracing.activeTreeId).toBe(1);
    expect(newState.skeletonTracing.activeNodeId).toBe(2);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toEqual(1);
    expect(_.size(newState.skeletonTracing.trees[1].nodes)).toEqual(2);
    expect(newState.skeletonTracing.trees[0].edges.length).toEqual(0);
    expect(newState.skeletonTracing.trees[1].edges).toEqual([
      { source: 1, target: 2 },
    ]);
  });

  it("shouldn't delete a node from an empty tree", () => {
    const action = addTimestamp(SkeletonTracingActions.deleteNodeAction());
    const newState = SkeletonTracingReducer(initalState, action);

    expect(newState).toEqual(initalState);
  });

  it("should delete a node from a tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());

    // Add two nodes, then delete one
    const newState = SkeletonTracingReducer(initalState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, createNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).toEqual(newState);
  });

  it("should delete a several nodes from a tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const deleteNodeAction = addTimestamp(SkeletonTracingActions.deleteNodeAction());

    // Add one node, then delete two times
    const newState = SkeletonTracingReducer(initalState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, deleteNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).toEqual(initalState);
  });

  it("should delete a nodes and split the tree", () => {
    // TODO @philipp
  });

  it("should set a new active node", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeAction = addTimestamp(SkeletonTracingActions.setActiveNodeAction(0));

    // Create two nodes, then set first one active
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeAction);

    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("should set a new active node in a different tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeAction = addTimestamp(SkeletonTracingActions.setActiveNodeAction(1));

    // Create one node in the first tree, then set create second tree with two nodes
    // Then set first node of second tree active
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeAction);

    expect(newState.skeletonTracing.activeNodeId).toBe(1);
    expect(newState.skeletonTracing.activeTreeId).toBe(1);
  });

  it("should set a new node radius", () => {
    const newRadius = 10;
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveNodeRadiusAction = addTimestamp(SkeletonTracingActions.setActiveNodeRadiusAction(newRadius));

    // Create a node and change its readius
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeRadiusAction);

    expect(newState.skeletonTracing.trees[0].nodes[0].radius).toEqual(newRadius);
  });

  it("should create a branchpoint", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create a single node and then set it as branchpoint
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.skeletonTracing.trees[0].branchPoints[0]).toEqual(jasmine.objectContaining({
      id: 0,
    }));
  });

  it("shouldn't create a branchpoint in an empty tree", () => {
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create a branchpoint in a tree without any nodes
    const newState = SkeletonTracingReducer(initalState, createBranchPointAction);
    expect(newState).toBe(initalState);
  });

  it("shouldn't create a branchpoint without the correct permissions", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

    // create a node and set a branch point in tracing without the correct permissions
    const startState = _.cloneDeep(initalState);
    startState.skeletonTracing.restrictions.branchPointsAllowed = false;

    let newState = SkeletonTracingReducer(startState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toEqual(0);
  });

  it("shouldn't create more branchpoints than nodes", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());

    // create one node and set it as branchpoint three times
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.skeletonTracing.trees[0].branchPoints[0]).toEqual(jasmine.objectContaining({
      id: 0,
    }));
  });

  it("should delete a branchpoint", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create one node and set it as branchpoint, create a second node and jump back to branchpoint
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toBe(2);
    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("should delete several branchpoints", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toBe(2);
    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("shouldn't delete more branchpoints than available", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create two nodes and set them both as branchpoint
    // then delete them both and jump back to first node
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toBe(0);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toBe(1);
    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("should delete a branchpoint from a different tree", () => {
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createBranchPointAction = addTimestamp(SkeletonTracingActions.createBranchPointAction());
    const deleteBranchPointAction = addTimestamp(SkeletonTracingActions.deleteBranchPointAction());

    // create a new tree, add a node, set it as branchpoint twice then delete the branchpoint
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);
    newState = SkeletonTracingReducer(newState, deleteBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toBe(0);
    expect(newState.skeletonTracing.trees[1].branchPoints.length).toBe(0);
  });

  it("should add a new tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const newState = SkeletonTracingReducer(initalState, createTreeAction);

    expect(_.size(newState.skeletonTracing.trees)).toBe(2);
    expect(newState.skeletonTracing.trees[1].treeId).toBe(1);
    expect(newState.skeletonTracing.activeTreeId).toBe(1);
    expect(newState.skeletonTracing.activeNodeId).toBe(null);
    expect(newState.skeletonTracing.trees[1]).toEqual(jasmine.objectContaining({
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
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);

    expect(_.size(newState.skeletonTracing.trees)).toBe(4);
    expect(_.max(_.map(newState.skeletonTracing.trees, "treeId"))).toBe(3);
    expect(newState.skeletonTracing.activeTreeId).toBe(3);
    expect(newState.skeletonTracing.activeNodeId).toBe(null);
  });

  it("should delete a new tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());

    // create a tree and delete it again
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);

    expect(newState).toEqual(initalState);
  });

  it("should delete several trees", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const deleteTreeAction = addTimestamp(SkeletonTracingActions.deleteTreeAction());

    // create a tree and delete it three times
    // there should always be at least one tree in a tracing
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);
    newState = SkeletonTracingReducer(newState, deleteTreeAction);

    expect(_.size(newState.skeletonTracing.trees)).toEqual(1);
    expect(newState.skeletonTracing.trees).not.toBe(initalState.skeletonTracing.trees);
    expect(newState.skeletonTracing.trees[0].treeId).toBe(0);
  });

  it("should set a new active tree", () => {
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(0));
    const newState = SkeletonTracingReducer(initalState, setActiveTreeAction);

    expect(newState.skeletonTracing.activeTreeId).toBe(0);
    expect(newState.skeletonTracing.activeNodeId).toBe(null);
  });

  it("should set a different active tree", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(1));

    // create a second tree with two nodes and set it active
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveTreeAction);

    expect(newState.skeletonTracing.activeTreeId).toBe(1);
    expect(newState.skeletonTracing.activeNodeId).toBe(1);
  });

  it("shouldn't set a new active tree for unknown tree ids", () => {
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(10));
    const newState = SkeletonTracingReducer(initalState, setActiveTreeAction);

    expect(newState).toBe(initalState);
  });

  it("should merge two trees", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const mergeTreesAction = addTimestamp(SkeletonTracingActions.mergeTreesAction(0, 2));

    // create a node in first tree, then create a second tree with three nodes and merge them
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, mergeTreesAction);

    expect(_.size(newState.skeletonTracing.trees)).toBe(1);
    expect(_.size(newState.skeletonTracing.trees[1].nodes)).toBe(4);
    expect(newState.skeletonTracing.trees[1].edges).toEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 0, target: 2 },
    ]);
  });

  it("should rename the active tree", () => {
    const newName = "SuperTestName";
    const setTreeNameAction = addTimestamp(SkeletonTracingActions.setTreeNameAction(newName));
    const newState = SkeletonTracingReducer(initalState, setTreeNameAction);

    expect(newState.skeletonTracing.trees[0].name).toEqual(newName);
  });

  it("should rename the active tree to a default name", () => {
    const setTreeNameAction = addTimestamp(SkeletonTracingActions.setTreeNameAction());
    const newState = SkeletonTracingReducer(initalState, setTreeNameAction);

    expect(newState.skeletonTracing.trees[0].name).toEqual("Tree000");
  });

  it("should increase the activeTreeId", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const setActiveTreeAction = addTimestamp(SkeletonTracingActions.setActiveTreeAction(0));
    const selectNextTreeAction = addTimestamp(SkeletonTracingActions.selectNextTreeAction());

    // create a second tree, set first tree active then increase activeTreeId
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, setActiveTreeAction);
    newState = SkeletonTracingReducer(newState, selectNextTreeAction);

    expect(newState.skeletonTracing.activeTreeId).toBe(1);
  });

  it("should decrease the activeTreeId", () => {
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());
    const selectNextTreeAction = addTimestamp(SkeletonTracingActions.selectNextTreeAction(false));

    // create a second tree then decrease activeTreeId
    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, selectNextTreeAction);

    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("should shuffle the tree color", () => {
    const shuffleTreeColorAction = addTimestamp(SkeletonTracingActions.shuffleTreeColorAction(0));
    const newState = SkeletonTracingReducer(initalState, shuffleTreeColorAction);

    expect(newState.skeletonTracing.trees[0].color).not.toEqual([23, 23, 23]);
  });

  it("should create a comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));

    // create a single node with a comment
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(1);
    expect(newState.skeletonTracing.trees[0].comments[0].comment).toEqual(commentText);
    expect(newState.skeletonTracing.trees[0].comments[0].node).toEqual(0);
  });

  it("shouldn't create a comments if there is no active node", () => {
    const commentText = "Wow such test comment";
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const newState = SkeletonTracingReducer(initalState, createCommentAction);
    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(0);
  });

  it("shouldn't create more than one comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));

    // create a node and add the same comment three times
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(1);
  });

  it("should create comments for several nodes", () => {
    const commentText1 = "Wow such test comment";
    const commentText2 = "Amaze test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));

    // create two nodes with a different comment each
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, addTimestamp(SkeletonTracingActions.createCommentAction(commentText1)));
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, addTimestamp(SkeletonTracingActions.createCommentAction(commentText2)));

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(2);
    expect(newState.skeletonTracing.trees[0].comments[0].comment).toEqual(commentText1);
    expect(newState.skeletonTracing.trees[0].comments[0].node).toEqual(0);
    expect(newState.skeletonTracing.trees[0].comments[1].comment).toEqual(commentText2);
    expect(newState.skeletonTracing.trees[0].comments[1].node).toEqual(1);
  });

  it("should create comments for a different tree", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const createTreeAction = addTimestamp(SkeletonTracingActions.createTreeAction());

    let newState = SkeletonTracingReducer(initalState, createTreeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(0);
    expect(newState.skeletonTracing.trees[1].comments.length).toEqual(1);
  });

  it("should delete a comment for a node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const deleteCommentAction = addTimestamp(SkeletonTracingActions.deleteCommentAction());

    // create a node with a comment, then delete it
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, deleteCommentAction);

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(0);
  });

  it("should only delete the comment for the active node", () => {
    const commentText = "Wow such test comment";

    const createNodeAction = addTimestamp(SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution));
    const createCommentAction = addTimestamp(SkeletonTracingActions.createCommentAction(commentText));
    const deleteCommentAction = addTimestamp(SkeletonTracingActions.deleteCommentAction());

    // create two nodes with a comment each and delete the comment for the last node
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createCommentAction);
    newState = SkeletonTracingReducer(newState, deleteCommentAction);

    expect(newState.skeletonTracing.trees[0].comments.length).toEqual(1);
    expect(newState.skeletonTracing.trees[0].comments[0].node).toEqual(0);
    expect(newState.skeletonTracing.trees[0].comments[0].comment).toEqual(commentText);
  });
});

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

mock.stopAll();
mock("app");
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
    const action = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
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
    expect(newState.skeletonTracing.trees[0].edges).toEqual(initalState.skeletonTracing.trees[0].edges);
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
    const action = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);

    // create three nodes
    let newState = SkeletonTracingReducer(initalState, action);
    newState = SkeletonTracingReducer(newState, action);
    newState = SkeletonTracingReducer(newState, action);

    const maxNodeId = _.max(Object.keys(newState.skeletonTracing.trees[0].nodes));
    expect(maxNodeId).toBe("2");
    expect(newState.skeletonTracing.activeNodeId).toBe(2);
    expect(_.size(newState.skeletonTracing.trees[0].nodes)).toEqual(3);
    expect(newState.skeletonTracing.trees[0].edges.length).toEqual(2);
    expect(newState.skeletonTracing.trees[0].edges).toEqual([
      { source: 0, target: 1 },
      { source: 1, target: 2 },
    ]);
  });

  it("should delete a node from an empty tree", () => {
    const action = SkeletonTracingActions.deleteNodeAction();
    const newState = SkeletonTracingReducer(initalState, action);

    expect(newState).toEqual(initalState);
  });

  it("should delete a node from a tree", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

    // Add two nodes, then delete one
    const newState = SkeletonTracingReducer(initalState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, createNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).toEqual(newState);
  });

  it("should delete a several nodes from a tree", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();

    // Add one node, then delete two times
    const newState = SkeletonTracingReducer(initalState, createNodeAction);
    const newStateA = SkeletonTracingReducer(newState, deleteNodeAction);
    const newStateB = SkeletonTracingReducer(newStateA, deleteNodeAction);

    expect(newStateB).toEqual(initalState);
  });

  it("should delete a nodes and split the tree", () => {
  });

  it("should set a new active node", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(0);

    // Create two nodes, then set first one active
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeAction);

    expect(newState.skeletonTracing.activeNodeId).toBe(0);
    expect(newState.skeletonTracing.activeTreeId).toBe(0);
  });

  it("should set a new active node in a different tree", () => {
  });

  it("should set a new node radius", () => {
    const newRadius = 10;
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const setActiveNodeRadiusAction = SkeletonTracingActions.setActiveNodeRadiusAction(newRadius);

    // Create a node and change its readius
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, setActiveNodeRadiusAction);

    expect(newState.skeletonTracing.trees[0].nodes[0].radius).toEqual(newRadius);
  });

  it("should create a branchpoint", () => {
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

    // create a single node and then set it as branchpoint
    let newState = SkeletonTracingReducer(initalState, createNodeAction);
    newState = SkeletonTracingReducer(newState, createBranchPointAction);

    expect(newState.skeletonTracing.trees[0].branchPoints.length).toEqual(1);
    expect(newState.skeletonTracing.trees[0].branchPoints[0]).toEqual(jasmine.objectContaining({
      id: 0,
    }));
  });

  it("shouldn't create a branchpoint in an empty tree", () => {
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

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
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();

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
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
    const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

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
    const createNodeAction = SkeletonTracingActions.createNodeAction(position, rotation, viewport, resolution);
    const createBranchPointAction = SkeletonTracingActions.createBranchPointAction();
    const deleteBranchPointAction = SkeletonTracingActions.deleteBranchPointAction();

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

  it("should delete a branchpoint from a different tree", () => {
  });

  it("should add a new tree", () => {
  });

  it("should add a several new trees", () => {
  });

  it("should delete a new tree", () => {
  });

  it("should delete several trees", () => {
  });

  it("should set a new active tree", () => {
  });

  it("should rename the active tree", () => {
  });
});

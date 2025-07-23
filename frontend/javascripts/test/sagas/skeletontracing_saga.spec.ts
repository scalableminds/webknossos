import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { SkeletonTracing, StoreAnnotation } from "viewer/store";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Store from "viewer/store";

import { chainReduce } from "test/helpers/chainReducer";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "viewer/model/edge_collection";
import compactSaveQueue from "viewer/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import defaultState from "viewer/default_state";
import update from "immutability-helper";
import {
  createSaveQueueFromUpdateActions,
  withoutUpdateActiveItemTracing,
} from "../helpers/saveHelpers";
import { MISSING_GROUP_ID } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { TreeTypeEnum } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/volume/update_actions";
import type { TracingStats } from "viewer/model/accessors/annotation_accessor";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import * as SkeletonTracingActions from "viewer/model/actions/skeletontracing_actions";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import { TIMESTAMP } from "test/global_mocks";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import { Model } from "viewer/singletons";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";

const actionTracingId = "skeletonTracingId";

function testDiffing(prevAnnotation: StoreAnnotation, nextAnnotation: StoreAnnotation) {
  return withoutUpdateActiveItemTracing(
    Array.from(
      diffSkeletonTracing(
        enforceSkeletonTracing(prevAnnotation),
        enforceSkeletonTracing(nextAnnotation),
      ),
    ),
  );
}

function createCompactedSaveQueueFromUpdateActions(
  updateActions: UpdateActionWithoutIsolationRequirement[][],
  timestamp: number,
  prevTracing: SkeletonTracing,
  tracing: SkeletonTracing,
  stats: TracingStats | null = null,
) {
  return compactSaveQueue(
    createSaveQueueFromUpdateActions(
      updateActions.map((batch) => compactUpdateActions(batch, prevTracing, tracing)),
      timestamp,
      stats,
    ),
  );
}

const skeletonTreeOne: Tree = {
  treeId: 1,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: 12345678,
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

const skeletonTracing: SkeletonTracing = {
  type: "skeleton",
  createdTimestamp: 0,
  tracingId: "skeletonTracingId",
  trees: new TreeMap([[1, skeletonTreeOne]]),
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

const initialState = update(defaultState, {
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
    skeleton: {
      $set: skeletonTracing,
    },
  },
});

const createNodeAction = SkeletonTracingActions.createNodeAction(
  [1, 2, 3],
  null,
  [0, 1, 0],
  0,
  1.2,
);
const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
const createTreeAction = SkeletonTracingActions.createTreeAction(undefined, 12345678);
const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();
const setNodeRadiusAction = SkeletonTracingActions.setNodeRadiusAction(12);
const createCommentAction = SkeletonTracingActions.createCommentAction("Hallo");
const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(
  undefined,
  undefined,
  12345678,
);

const applyActions = chainReduce(SkeletonTracingReducer);

describe("SkeletonTracingSaga", () => {
  describe("With Saga Middleware", () => {
    beforeEach<WebknossosTestContext>(async (context) => {
      await setupWebknossosForTesting(context, "skeleton");
    });

    afterEach<WebknossosTestContext>(async (context) => {
      context.tearDownPullQueues();
      // Saving after each test and checking that the root saga didn't crash,
      // ensures that each test is cleanly exited. Without it weird output can
      expect(hasRootSagaCrashed()).toBe(false);
    });

    it("shouldn't do anything if unchanged (saga test)", async (context: WebknossosTestContext) => {
      await Model.ensureSavedState();
      expect(context.receivedDataPerSaveRequest.length).toBe(0);
    });

    it("should do something if changed (saga test)", async (context: WebknossosTestContext) => {
      Store.dispatch(createNodeAction);
      await Model.ensureSavedState();
      expect(context.receivedDataPerSaveRequest.length).toBe(1);
      const requestBatches = context.receivedDataPerSaveRequest[0];
      expect(requestBatches.length).toBe(1);
      const updateBatch = requestBatches[0];
      expect(updateBatch.actions.map((action) => action.name)).toEqual([
        "createNode",
        "createEdge",
        "updateActiveNode",
      ]);
    });
  });

  it("should emit createNode update actions", () => {
    const newState = SkeletonTracingReducer(initialState, createNodeAction);
    const updateActions = testDiffing(initialState.annotation, newState.annotation);
    expect(updateActions[0]).toMatchObject({
      name: "createNode",
      value: {
        id: 1,
        treeId: 1,
      },
    });
  });

  it("should emit createNode and createEdge update actions", () => {
    const newState = applyActions(initialState, [createNodeAction, createNodeAction]);
    const updateActions = testDiffing(initialState.annotation, newState.annotation);
    expect(updateActions[0]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 1,
        treeId: 1,
      },
    });
    expect(updateActions[1]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 2,
        treeId: 1,
      },
    });
    expect(updateActions[2]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 1,
        source: 1,
        target: 2,
      },
    });
  });

  it("should emit createNode and createTree update actions", () => {
    const newState = applyActions(initialState, [
      createNodeAction,
      createTreeAction,
      createNodeAction,
    ]);

    const updateActions = testDiffing(initialState.annotation, newState.annotation);

    expect(updateActions[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    expect(updateActions[1]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 2,
        treeId: 2,
      },
    });
    expect(updateActions[2]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 1,
        treeId: 1,
      },
    });
  });

  it("should emit first deleteNode and then createNode update actions", () => {
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 2);
    const testState = applyActions(initialState, [
      createNodeAction,
      createTreeAction,
      createNodeAction,
    ]);

    const newState = SkeletonTracingReducer(testState, mergeTreesAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 2,
      },
    });
    expect(updateActions[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    expect(updateActions[2]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 2,
        treeId: 1,
      },
    });
    expect(updateActions[3]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 1,
        source: 1,
        target: 2,
      },
    });
  });

  it("should emit a deleteNode update action", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 1,
        treeId: 1,
      },
    });
  });

  it("should emit a deleteEdge update action", () => {
    const testState = applyActions(initialState, [createNodeAction, createNodeAction]);
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 1,
      },
    });
    expect(updateActions[1]).toEqual({
      name: "deleteEdge",
      value: {
        actionTracingId,
        treeId: 1,
        source: 1,
        target: 2,
      },
    });
  });

  it("should emit a deleteTree update action", () => {
    const testState = SkeletonTracingReducer(initialState, createTreeAction);
    const newState = SkeletonTracingReducer(testState, deleteTreeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);
    expect(updateActions[0]).toMatchObject({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
  });

  it("should emit an updateNode update action", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);
    expect(updateActions[0]).toMatchObject({
      name: "updateNode",
      value: {
        actionTracingId,
        id: 1,
        treeId: 1,
        radius: 12,
      },
    });
  });

  it("should emit an updateNode update action 2", () => {
    const testState = applyActions(initialState, [createNodeAction, setNodeRadiusAction]);

    const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (comments)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toMatchObject({
      name: "updateTree",
      value: {
        actionTracingId,
        id: 1,
        comments: [
          {
            nodeId: 1,
            content: "Hallo",
          },
        ],
      },
    });
  });

  it("shouldn't emit an updateTree update actions (comments)", () => {
    const testState = applyActions(initialState, [createNodeAction, createCommentAction]);

    const newState = SkeletonTracingReducer(testState, createCommentAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions).toEqual([]);
  });

  it("should emit an updateTree update actions (branchpoints)", () => {
    const testState = SkeletonTracingReducer(initialState, createNodeAction);
    const newState = SkeletonTracingReducer(testState, createBranchPointAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toMatchObject({
      name: "updateTree",
      value: {
        actionTracingId,
        id: 1,
        branchPoints: [
          {
            nodeId: 1,
            timestamp: 12345678,
          },
        ],
      },
    });
  });

  it("should emit update actions on merge tree", () => {
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
    // create a node in first tree, then create a second tree with three nodes and merge them
    const testState = applyActions(initialState, [
      createNodeAction,
      createTreeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
    ]);

    const newState = SkeletonTracingReducer(testState, mergeTreesAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        treeId: 1,
        nodeId: 1,
      },
    });
    expect(updateActions[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 1,
      },
    });
    expect(updateActions[2]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 1,
        treeId: 2,
      },
    });
    expect(updateActions[3]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 3,
        target: 1,
      },
    });
  });

  it("should emit update actions on split tree", () => {
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
    // create a node in first tree, then create a second tree with three nodes and merge them
    const testState = applyActions(initialState, [
      createNodeAction,
      createTreeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
      mergeTreesAction,
    ]);

    // Node 3 will be deleted since it is active in testState.
    const newState = SkeletonTracingReducer(testState, deleteNodeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    expect(updateActions[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 3,
      },
    });
    expect(updateActions[1]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 2,
        treeId: 3,
      },
    });
    expect(updateActions[2]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 4,
      },
    });
    expect(updateActions[3]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 4,
        treeId: 4,
      },
    });
    expect(updateActions[4]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        treeId: 2,
        nodeId: 2,
      },
    });
    expect(updateActions[5]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        treeId: 2,
        nodeId: 3,
      },
    });
    expect(updateActions[6]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        treeId: 2,
        nodeId: 4,
      },
    });
    expect(updateActions[7]).toEqual({
      name: "deleteEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 2,
        target: 3,
      },
    });
    expect(updateActions[8]).toEqual({
      name: "deleteEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 3,
        target: 4,
      },
    });
    expect(updateActions[9]).toEqual({
      name: "deleteEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 3,
        target: 1,
      },
    });
  });

  it("compactUpdateActions should detect a tree merge (1/3)", () => {
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(4, 1);
    // Create three nodes in the first tree, then create a second tree with one node and merge them
    const testState = applyActions(initialState, [
      createNodeAction,
      createNodeAction,
      createNodeAction,
      createTreeAction,
      createNodeAction,
    ]);

    const newState = SkeletonTracingReducer(testState, mergeTreesAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    // This should result in a moved treeComponent of size three
    expect(simplifiedFirstBatch[0]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 2,
        nodeIds: [1, 2, 3],
      },
    });
    // the deletion of the merged tree
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 1,
      },
    });
    // and a new edge to connect the two trees
    expect(simplifiedFirstBatch[2]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 4,
        target: 1,
      },
    });
    expect(simplifiedFirstBatch.length).toBe(3);
  });

  it("compactUpdateActions should detect a tree merge (2/3)", () => {
    // In this test multiple diffs are performed and concatenated before compactUpdateActions is invoked
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(5, 1);
    // Create three nodes in the first tree, then create a second tree with one node
    const testState = applyActions(initialState, [
      createNodeAction,
      createNodeAction,
      createNodeAction,
      createTreeAction,
      createNodeAction,
    ]);

    // Create another node (a)
    const newState1 = SkeletonTracingReducer(testState, createNodeAction);
    const updateActions = [];
    updateActions.push(testDiffing(testState.annotation, newState1.annotation));

    // Merge the two trees (b), then create another tree and node (c)
    const newState2 = applyActions(newState1, [
      mergeTreesAction,
      createTreeAction,
      createNodeAction,
    ]);
    updateActions.push(testDiffing(newState1.annotation, newState2.annotation));
    // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      updateActions,
      TIMESTAMP,
      newState1.annotation.skeleton!,
      newState2.annotation.skeleton!,
    );

    // This should result in one created node and its edge (a)
    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toMatchObject({
      name: "createNode",
      value: {
        actionTracingId,
        id: 5,
        treeId: 2,
      },
    });
    expect(simplifiedFirstBatch[1]).toMatchObject({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 4,
        target: 5,
      },
    });
    expect(simplifiedFirstBatch.length).toBe(2);
    const simplifiedSecondBatch = simplifiedUpdateActions[1].actions;

    // a moved tree component of size three (b)
    expect(simplifiedSecondBatch[0]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 2,
        nodeIds: [1, 2, 3],
      },
    });
    // the deletion of the merged tree (b)
    expect(simplifiedSecondBatch[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 1,
      },
    });
    // the creation of a new tree and node (c)
    expect(simplifiedSecondBatch[2].name).toBe("createTree");
    expect(simplifiedSecondBatch[3].name).toBe("createNode");
    // a new edge to connect the two trees (b)
    expect(simplifiedSecondBatch[4]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 2,
        source: 5,
        target: 1,
      },
    });
    expect(simplifiedSecondBatch.length).toBe(5);
  });

  it("compactUpdateActions should detect a tree merge (3/3)", () => {
    // In this test multiple merges and diffs are performed and concatenated before compactUpdateActions is invoked
    const firstMergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 4);
    const secondMergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 6);

    // Create three nodes in the first tree, then create a second tree with one node
    const testState = applyActions(initialState, [
      createNodeAction, // nodeId=1
      createNodeAction, // nodeId=2
      createNodeAction, // nodeId=3
      createTreeAction,
      createNodeAction, // nodeId=4
    ]);

    // Merge the second tree into the first tree (a)
    const stateAfterFirstMerge = SkeletonTracingReducer(testState, firstMergeTreesAction);
    const updateActions = [];
    updateActions.push(testDiffing(testState.annotation, stateAfterFirstMerge.annotation));

    // Create another tree and two nodes (b)
    const newState = applyActions(stateAfterFirstMerge, [
      createTreeAction,
      createNodeAction, // nodeId=5
      createNodeAction, // nodeId=6
    ]);

    updateActions.push(testDiffing(stateAfterFirstMerge.annotation, newState.annotation));

    // Merge the second tree into the first tree again (c)
    const stateAfterSecondMerge = SkeletonTracingReducer(newState, secondMergeTreesAction);
    updateActions.push(testDiffing(newState.annotation, stateAfterSecondMerge.annotation));

    // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      updateActions,
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    // This should result in a moved treeComponent of size one (a)
    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 2,
        targetId: 1,
        nodeIds: [4],
      },
    });
    // the deletion of the first merged tree (a)
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    // the creation of an edge two connect the first two trees (a)
    expect(simplifiedFirstBatch[2]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 1,
        source: 1,
        target: 4,
      },
    });
    expect(simplifiedFirstBatch.length).toBe(3);

    // the creation of another tree, two nodes and one edge (b)
    const simplifiedSecondBatch = simplifiedUpdateActions[1].actions;
    expect(simplifiedSecondBatch[0].name).toBe("createTree");
    expect(simplifiedSecondBatch[1].name).toBe("createNode");
    expect(simplifiedSecondBatch[2].name).toBe("createNode");
    expect(simplifiedSecondBatch[3].name).toBe("createEdge");
    expect(simplifiedSecondBatch.length).toBe(4);

    // a second merge (c)
    const simplifiedThirdBatch = simplifiedUpdateActions[2].actions;
    expect(simplifiedThirdBatch[0]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 2,
        targetId: 1,
        nodeIds: [5, 6],
      },
    });
    expect(simplifiedThirdBatch[1]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    expect(simplifiedThirdBatch[2]).toEqual({
      name: "createEdge",
      value: {
        actionTracingId,
        treeId: 1,
        source: 1,
        target: 6,
      },
    });
    expect(simplifiedThirdBatch.length).toBe(3);
  });

  it("compactUpdateActions should detect a tree split (1/3)", () => {
    const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
    // Create four nodes
    const testState = applyActions(initialState, [
      createNodeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
    ]);

    // Delete the second node to split the tree
    const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);

    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    // This should result in a new tree
    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    // a treeComponent of size two that is moved to the new tree
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 2,
        nodeIds: [3, 4],
      },
    });
    // the deletion of the node and its two edges
    expect(simplifiedFirstBatch[2]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 1,
      },
    });
    expect(simplifiedFirstBatch[3].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch[4].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch.length).toBe(5);
  });

  it("compactUpdateActions should detect a tree split (2/3)", () => {
    // Branchpoint tree split
    const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
    const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(2);
    // Create four nodes, then set node 2 as active and create another three nodes
    // Node 2 now has three neighbors
    const testState = applyActions(initialState, [
      createNodeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
      setActiveNodeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
    ]);

    // Delete node 2 to split the tree into three parts
    const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
    const updateActions = testDiffing(testState.annotation, newState.annotation);
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    // This should result in two new trees and two moved treeComponents of size three and two
    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 2,
        nodeIds: [3, 4],
      },
    });
    expect(simplifiedFirstBatch[2]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 3,
      },
    });
    expect(simplifiedFirstBatch[3]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 3,
        nodeIds: [5, 6, 7],
      },
    });
    // the deletion of the node and its three edges
    expect(simplifiedFirstBatch[4]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 1,
      },
    });
    expect(simplifiedFirstBatch[5].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch[6].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch[7].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch.length).toBe(8);
  });

  it("compactUpdateActions should detect a tree split (3/3)", () => {
    // Detect multiple tree splits
    const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
    const deleteOtherMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(4);

    // Create six nodes
    const testState = applyActions(initialState, [
      createNodeAction, // nodeId=1
      createNodeAction, // nodeId=2 <-- will be deleted
      createNodeAction, // nodeId=3
      createNodeAction, // nodeId=4 <-- will be deleted
      createNodeAction, // nodeId=5
      createNodeAction, // nodeId=6
    ]);

    // Delete the second node to split the tree (a)
    const newState1 = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
    const updateActions1 = [testDiffing(testState.annotation, newState1.annotation)];
    const simplifiedUpdateActions1 = createCompactedSaveQueueFromUpdateActions(
      updateActions1,
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState1.annotation.skeleton!,
    );
    // Delete node 4 to split the tree again (b)
    const newState2 = SkeletonTracingReducer(newState1, deleteOtherMiddleNodeAction);
    const updateActions2 = [testDiffing(newState1.annotation, newState2.annotation)];
    const simplifiedUpdateActions2 = createCompactedSaveQueueFromUpdateActions(
      updateActions2,
      TIMESTAMP,
      newState1.annotation.skeleton!,
      newState2.annotation.skeleton!,
    );

    // This should result in the creation of a new tree (a)
    const simplifiedFirstBatch = simplifiedUpdateActions1[0].actions;
    expect(simplifiedFirstBatch[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    // a treeComponent of size four that is moved to the new tree (a)
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 1,
        targetId: 2,
        nodeIds: [3, 4, 5, 6],
      },
    });
    // and the deletion of the node and its two edges (a)
    expect(simplifiedFirstBatch[2]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 1,
      },
    });
    expect(simplifiedFirstBatch[3].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch[4].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch.length).toBe(5);
    expect(simplifiedUpdateActions1.length).toBe(1);

    // the creation of a new tree (b)
    const simplifiedSecondBatch = simplifiedUpdateActions2[0].actions;
    expect(simplifiedUpdateActions2.length).toBe(1);
    expect(simplifiedSecondBatch[0]).toMatchObject({
      name: "createTree",
      value: {
        actionTracingId,
        id: 3,
      },
    });
    // a treeComponent of size two that is moved to the new tree (b)
    expect(simplifiedSecondBatch[1]).toEqual({
      name: "moveTreeComponent",
      value: {
        actionTracingId,
        sourceId: 2,
        targetId: 3,
        nodeIds: [5, 6],
      },
    });
    // and the deletion of the node and its two edges (b)
    expect(simplifiedSecondBatch[2]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 4,
        treeId: 2,
      },
    });
    expect(simplifiedSecondBatch[3].name).toBe("deleteEdge");
    expect(simplifiedSecondBatch[4].name).toBe("deleteEdge");
    expect(simplifiedSecondBatch.length).toBe(5);
    expect(simplifiedUpdateActions2.length).toBe(1);
  });

  it("compactUpdateActions should do nothing if it cannot compact", () => {
    // The moveTreeComponent update action moves a list of nodeIds from and oldTreeId to a newTreeId
    // If the tree with the oldTreeId is deleted and the tree with the newTreeId is created
    // in the same diff, compactUpdateActions cannot insert the moveTreeComponent update action at
    // the right spot (see code comments for why)
    // This case cannot happen currently as there is no action in webknossos that results in such a diff,
    // it could however exist in the future and this test makes sure things won't break then
    const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(2, 1);
    // Create three nodes in the first tree, then create a second tree with one node and merge them
    const testState = applyActions(initialState, [createNodeAction]);

    // Create the tree that is merged to and merge the trees at the same time
    const newState = applyActions(testState, [
      createTreeAction,
      createNodeAction,
      mergeTreesAction,
    ]);

    // This will currently never be the result of one diff (see description of the test)
    const updateActions = testDiffing(testState.annotation, newState.annotation);
    const saveQueueOriginal = createSaveQueueFromUpdateActions([updateActions], TIMESTAMP);
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );
    // The deleteTree optimization in compactUpdateActions (that is unrelated to this test)
    // will remove the first deleteNode update action as the first tree is deleted because of the merge,
    // therefore remove it here as well
    saveQueueOriginal[0].actions.shift();

    // Nothing should be changed as the moveTreeComponent update action cannot be inserted
    expect(simplifiedUpdateActions).toEqual(saveQueueOriginal);
  });

  it("compactUpdateActions should detect a deleted tree", () => {
    const testState = applyActions(initialState, [
      createTreeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
    ]);

    // Delete the tree
    const newState = applyActions(testState, [deleteTreeAction]);

    const updateActions = testDiffing(testState.annotation, newState.annotation);
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toEqual({
      name: "deleteTree",
      value: {
        actionTracingId,
        id: 2,
      },
    });
    expect(simplifiedFirstBatch.length).toBe(1);
  });

  it("compactUpdateActions should not detect a deleted tree if there is no deleted tree", () => {
    const testState = applyActions(initialState, [
      createTreeAction,
      createNodeAction,
      createNodeAction,
      createNodeAction,
    ]);

    // Delete almost all nodes from the tree
    const newState = applyActions(testState, [deleteNodeAction, deleteNodeAction]);

    const updateActions = testDiffing(testState.annotation, newState.annotation);
    const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
      [updateActions],
      TIMESTAMP,
      testState.annotation.skeleton!,
      newState.annotation.skeleton!,
    );

    const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
    expect(simplifiedFirstBatch[0]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 2,
        treeId: 2,
      },
    });
    expect(simplifiedFirstBatch[1]).toEqual({
      name: "deleteNode",
      value: {
        actionTracingId,
        nodeId: 3,
        treeId: 2,
      },
    });
    expect(simplifiedFirstBatch[2].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch[3].name).toBe("deleteEdge");
    expect(simplifiedFirstBatch.length).toBe(4);
  });
});

import update from "immutability-helper";
import _ from "lodash";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultState } from "test/fixtures/hybridtracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import type { Vector3 } from "viewer/constants";
import {
  enforceSkeletonTracing,
  getActiveNode,
  getActiveTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import * as SkeletonTracingActions from "viewer/model/actions/skeletontracing_actions";
import { SkeletonTracingAction } from "viewer/model/actions/skeletontracing_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import type {
  ApplicableSkeletonUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/update_actions";
import { combinedReducers, type WebknossosState } from "viewer/store";
import { describe, expect, test, it, afterAll } from "vitest";

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
  dataset: {
    dataSource: {
      dataLayers: {
        $set: [sampleTracingLayer],
      },
    },
  },
});

const position = [10, 10, 10] as Vector3;
const rotation = [0.5, 0.5, 0.5] as Vector3;
const viewport = 0;
const mag = 0;

const applyActions = chainReduce(combinedReducers);

const actionNamesList: Record<ApplicableSkeletonUpdateAction["name"], true> = {
  updateTree: true,
  createTree: true,
  updateNode: true,
  createNode: true,
  createEdge: true,
  deleteTree: true,
  deleteEdge: true,
  deleteNode: true,
  moveTreeComponent: true,
  addUserBoundingBoxInSkeletonTracing: true,
  updateUserBoundingBoxInSkeletonTracing: true,
  deleteUserBoundingBoxInSkeletonTracing: true,
};

describe("Update Action Application for SkeletonTracing", () => {
  const seenActionTypes = new Set<string>();

  let idx = 0;
  const createNode = () =>
    SkeletonTracingActions.createNodeAction([10, 10, idx++], null, rotation, viewport, mag);

  /*
   * Hardcode these values if you want to focus on a specific test.
   */
  const compactionModes = [true, false];
  const hardcodedBeforeVersionIndex: number | null = null;
  const hardcodedAfterVersionIndex: number | null = null;
  // const compactionModes = [true];
  // const hardcodedBeforeVersionIndex: number | null = 27; // 14;
  // const hardcodedAfterVersionIndex: number | null = 28; // 26;

  const userActions: SkeletonTracingAction[] = [
    SkeletonTracingActions.deleteTreeAction(2), // delete second tree. one tree remains.
    createNode(), // nodeId=1
    createNode(), // nodeId=2
    createNode(), // nodeId=3
    createNode(), // nodeId=4
    createNode(), // nodeId=5
    SkeletonTracingActions.deleteNodeAction(3), // tree components == {1,2} {4,5}
    SkeletonTracingActions.createTreeAction(),
    createNode(), // nodeId=6
    createNode(), // nodeId=7
    createNode(), // nodeId=8, tree components == {1,2} {4,5} {6,7,8}
    SkeletonTracingActions.setTreeNameAction("Special Name", 1),
    SkeletonTracingActions.setActiveNodeAction(null),
    SkeletonTracingActions.mergeTreesAction(5, 7), // tree components {1,2} {4,5,6,7,8}
    SkeletonTracingActions.setActiveNodeAction(2),
    createNode(), // nodeId=9, tree components {1,2,9} {4,5,6,7,8}
    SkeletonTracingActions.setActiveNodeAction(2),
    createNode(), // nodeId=10, tree components {1,2,9,10} {4,5,6,7,8}
    SkeletonTracingActions.setActiveNodeAction(1),
    createNode(), // nodeId=11, tree components {11,1,2,9,10} {4,5,6,7,8}
    SkeletonTracingActions.deleteEdgeAction(1, 2), // tree components {11,1} {2,9,10} {4,5,6,7,8}
    SkeletonTracingActions.createTreeAction(),
    createNode(), // nodeId=12
    createNode(), // nodeId=13
    createNode(), // nodeId=14, tree components == {1,2} {4,5} {6,7,8} {12,13,14}
    SkeletonTracingActions.deleteTreeAction(3),
    SkeletonTracingActions.setNodePositionAction([1, 2, 3], 6),
    // addUserBoundingBoxAction({
    //   boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
    //   name: "UserBBox",
    //   color: [1, 2, 3],
    //   isVisible: true,
    // }),
  ];

  test.skip("User actions for test should not contain no-ops", () => {
    let state = initialState;
    for (const action of userActions) {
      // todop: use wk reducer so that addUserBoundingBoxAction does sth
      const newState = SkeletonTracingReducer(state, action);
      expect(newState !== state).toBeTruthy();

      state = newState;
    }
  });

  const beforeVersionIndices =
    hardcodedBeforeVersionIndex != null
      ? [hardcodedBeforeVersionIndex]
      : _.range(0, userActions.length);

  // it.only("should re-apply update actions from complex diff and get same state", () => {
  describe.each(compactionModes)(
    "[Compaction=%s]: should re-apply update actions from complex diff and get same state",
    (withCompaction) => {
      describe.each(beforeVersionIndices)("From v=%i", (beforeVersionIndex: number) => {
        const afterVersionIndices =
          hardcodedAfterVersionIndex != null
            ? [hardcodedAfterVersionIndex]
            : _.range(beforeVersionIndex + 1, userActions.length + 1);

        test.each(afterVersionIndices)("To v=%i", (afterVersionIndex: number) => {
          const state2WithActiveTree = applyActions(
            initialState,
            userActions.slice(0, beforeVersionIndex),
          );

          const state2WithoutActiveTree = applyActions(state2WithActiveTree, [
            SkeletonTracingActions.setActiveNodeAction(null),
          ]);

          const actionsToApply = userActions.slice(beforeVersionIndex, afterVersionIndex + 1);
          const state3 = applyActions(
            state2WithActiveTree,
            actionsToApply.concat([SkeletonTracingActions.setActiveNodeAction(null)]),
          );
          expect(state2WithoutActiveTree !== state3).toBeTruthy();

          // logTrees("state2", state2);
          // logTrees("state3", state3);
          const skeletonTracing2 = enforceSkeletonTracing(state2WithoutActiveTree.annotation);
          const skeletonTracing3 = enforceSkeletonTracing(state3.annotation);

          const updateActionsBeforeCompaction = Array.from(
            diffSkeletonTracing(skeletonTracing2, skeletonTracing3),
          );
          // console.log("updateActionsBeforeCompaction", updateActionsBeforeCompaction);
          const maybeCompact = withCompaction
            ? compactUpdateActions
            : (updateActions: UpdateActionWithoutIsolationRequirement[]) => updateActions;
          const updateActions = maybeCompact(
            updateActionsBeforeCompaction,
            skeletonTracing2,
            skeletonTracing3,
          ) as ApplicableSkeletonUpdateAction[];

          for (const action of updateActions) {
            seenActionTypes.add(action.name);
          }

          // console.log("updateActions", updateActions);
          expect(updateActions.length > 0).toBeTruthy();

          const reappliedNewState = applyActions(state2WithoutActiveTree, [
            SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
            SkeletonTracingActions.setActiveNodeAction(null),
          ]);

          // logTrees("state3", state3);
          // logTrees("reappliedNewState", reappliedNewState);

          expect(reappliedNewState).toEqual(state3);
        });
      });
    },
  );

  it.skip("should clear the active node if it was deleted", () => {
    const createNode = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const newState = applyActions(initialState, [
      createNode, // 1
      createNode, // 2
      SkeletonTracingActions.setActiveNodeAction(2),
    ]);
    expect(getActiveNode(enforceSkeletonTracing(newState.annotation))?.id).toBe(2);

    const newState2 = applyActions(newState, [SkeletonTracingActions.deleteNodeAction(2)]);

    const updateActions = Array.from(
      diffSkeletonTracing(newState.annotation.skeleton!, newState2.annotation.skeleton!),
    ) as ApplicableSkeletonUpdateAction[];

    const newState3 = applyActions(newState, [
      SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
    ]);

    expect(getActiveNode(enforceSkeletonTracing(newState3.annotation))).toBeNull();
  });

  it.skip("should clear the active node and active tree if the active tree was deleted", () => {
    const createNode = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const newState = applyActions(initialState, [
      createNode, // 1
      createNode, // 2
      SkeletonTracingActions.setActiveTreeAction(2),
    ]);
    expect(getActiveTree(enforceSkeletonTracing(newState.annotation))?.treeId).toBe(2);

    const newState2 = applyActions(newState, [SkeletonTracingActions.deleteTreeAction(2)]);

    const updateActions = Array.from(
      diffSkeletonTracing(newState.annotation.skeleton!, newState2.annotation.skeleton!),
    ) as ApplicableSkeletonUpdateAction[];

    const newState3 = applyActions(newState, [
      SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
    ]);

    expect(getActiveTree(enforceSkeletonTracing(newState3.annotation))).toBeNull();
    expect(getActiveNode(enforceSkeletonTracing(newState3.annotation))).toBeNull();
  });

  afterAll(() => {
    console.log("Seen action types:", [...seenActionTypes]);
    // expect(seenActionTypes).toEqual(new Set(Object.keys(actionNamesList)));
  });
});

function _logTrees(prefix: string, state: WebknossosState) {
  const size = state.annotation.skeleton!.trees.getOrThrow(1).nodes.size();
  console.log("logTrees. size", size);
  for (const tree of state.annotation.skeleton!.trees.values()) {
    console.log(
      `${prefix}. tree.id=${tree.treeId}.`,
      "edges: ",
      // Array.from(tree.edges.values().map((edge) => `${edge.source}-${edge.target}`)).join(", "),
      "nodes: ",
      Array.from(tree.nodes.values().map((n) => n.id)).join(", "),
    );
  }
}

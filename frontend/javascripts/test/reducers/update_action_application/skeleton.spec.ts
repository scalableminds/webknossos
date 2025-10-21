import update from "immutability-helper";
import _ from "lodash";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultSkeletonState } from "test/fixtures/skeletontracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import { transformStateAsReadOnly } from "test/helpers/utils";
import type { Vector3 } from "viewer/constants";
import {
  enforceSkeletonTracing,
  getActiveNode,
  getActiveTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import * as SkeletonTracingActions from "viewer/model/actions/skeletontracing_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import type {
  ApplicableSkeletonServerUpdateAction,
  ApplicableSkeletonUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import { combinedReducer, type WebknossosState } from "viewer/store";
import { makeBasicGroupObject } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { describe, expect, test, it, afterAll } from "vitest";

const initialState: WebknossosState = update(defaultSkeletonState, {
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

const addMissingTimestampProp = (
  actions: UpdateActionWithoutIsolationRequirement[],
): ApplicableSkeletonServerUpdateAction[] => {
  return actions.map(
    (a) =>
      ({
        ...a,
        value: { ...a.value, actionTimestamp: 0 },
      }) as ApplicableSkeletonServerUpdateAction,
  );
};

const applyActions = chainReduce(combinedReducer);

// This helper dict exists so that we can ensure via typescript that
// the list contains all members of ApplicableSkeletonUpdateAction. As soon as
// ApplicableSkeletonUpdateAction is extended with another action, TS will complain
// if the following dictionary doesn't contain that action.
const actionNamesHelper: Record<ApplicableSkeletonUpdateAction["name"], true> = {
  updateTree: true,
  createTree: true,
  updateNode: true,
  createNode: true,
  createEdge: true,
  deleteTree: true,
  deleteEdge: true,
  deleteNode: true,
  moveTreeComponent: true,
  updateTreeGroups: true,
  updateTreeGroupsExpandedState: true,
  updateTreeEdgesVisibility: true,
  addUserBoundingBoxInSkeletonTracing: true,
  updateUserBoundingBoxInSkeletonTracing: true,
  updateUserBoundingBoxVisibilityInSkeletonTracing: true,
  deleteUserBoundingBoxInSkeletonTracing: true,
  updateActiveNode: true,
  updateTreeVisibility: true,
  updateTreeGroupVisibility: true,
};
const actionNamesList = Object.keys(actionNamesHelper);

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

  const userActions: Action[] = [
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
    SkeletonTracingActions.setTreeVisibilityAction(1, false),
    SkeletonTracingActions.createTreeAction(),
    createNode(), // nodeId=12
    createNode(), // nodeId=13
    createNode(), // nodeId=14, tree components == {1,2} {4,5} {6,7,8} {12,13,14}
    SkeletonTracingActions.deleteTreeAction(3),
    SkeletonTracingActions.setNodePositionAction([1, 2, 3], 6),
    addUserBoundingBoxAction({
      boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
      name: "UserBBox",
      color: [1, 2, 3],
      isVisible: true,
    }),
    changeUserBoundingBoxAction(1, { name: "Updated Name" }),
    deleteUserBoundingBoxAction(1),
    SkeletonTracingActions.setTreeGroupsAction([
      makeBasicGroupObject(3, "group 3"),
      makeBasicGroupObject(7, "group 7"),
    ]),
    SkeletonTracingActions.toggleTreeGroupAction(3),
    SkeletonTracingActions.setTreeGroupAction(7, 2),
    SkeletonTracingActions.setTreeEdgeVisibilityAction(2, false),
  ];

  test("User actions for test should not contain no-ops", () => {
    let state = initialState;
    for (const action of userActions) {
      const newState = combinedReducer(state, action);
      expect(newState !== state).toBeTruthy();

      state = newState;
    }
  });

  const beforeVersionIndices =
    hardcodedBeforeVersionIndex != null
      ? [hardcodedBeforeVersionIndex]
      : _.range(0, userActions.length);

  describe.each(compactionModes)(
    "[Compaction=%s]: should re-apply update actions from complex diff and get same state",
    (withCompaction) => {
      describe.each(beforeVersionIndices)("From v=%i", (beforeVersionIndex: number) => {
        const afterVersionIndices =
          hardcodedAfterVersionIndex != null
            ? [hardcodedAfterVersionIndex]
            : _.range(beforeVersionIndex, userActions.length + 1);

        test.each(afterVersionIndices)("To v=%i", (afterVersionIndex: number) => {
          const state2WithActiveTree = applyActions(
            initialState,
            userActions.slice(0, beforeVersionIndex),
          );

          const state2WithoutActiveState = applyActions(state2WithActiveTree, [
            SkeletonTracingActions.setActiveNodeAction(null),
            setActiveUserBoundingBoxId(null),
          ]);

          const actionsToApply = userActions.slice(beforeVersionIndex, afterVersionIndex + 1);
          const state3 = applyActions(
            state2WithActiveTree,
            actionsToApply.concat([
              SkeletonTracingActions.setActiveNodeAction(null),
              setActiveUserBoundingBoxId(null),
            ]),
          );
          expect(state2WithoutActiveState !== state3).toBeTruthy();

          const skeletonTracing2 = enforceSkeletonTracing(state2WithoutActiveState.annotation);
          const skeletonTracing3 = enforceSkeletonTracing(state3.annotation);

          const updateActionsBeforeCompaction = Array.from(
            diffSkeletonTracing(skeletonTracing2, skeletonTracing3),
          );
          const maybeCompact = withCompaction
            ? compactUpdateActions
            : (updateActions: UpdateActionWithoutIsolationRequirement[]) => updateActions;

          const updateActions = addMissingTimestampProp(
            maybeCompact(updateActionsBeforeCompaction, skeletonTracing2, skeletonTracing3),
          );

          for (const action of updateActions) {
            seenActionTypes.add(action.name);
          }

          const reappliedNewState = transformStateAsReadOnly(state2WithoutActiveState, (state) =>
            applyActions(state, [
              SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
              SkeletonTracingActions.setActiveNodeAction(null),
              setActiveUserBoundingBoxId(null),
            ]),
          );

          expect(reappliedNewState).toEqual(state3);
        });
      });
    },
  );

  it("should clear the active node if it was deleted", () => {
    const createNode = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const newState = applyActions(initialState, [
      createNode, // nodeId=1
      createNode, // nodeId=2
      SkeletonTracingActions.setActiveNodeAction(2),
    ]);
    expect(getActiveNode(enforceSkeletonTracing(newState.annotation))?.id).toBe(2);

    const newState2 = applyActions(newState, [SkeletonTracingActions.deleteNodeAction(2)]);

    const updateActions = addMissingTimestampProp(
      Array.from(
        diffSkeletonTracing(newState.annotation.skeleton!, newState2.annotation.skeleton!),
      ),
    );
    const updateActionsWithoutUpdatingActiveNode = updateActions.slice(0, 2);
    const newState3 = transformStateAsReadOnly(newState, (state) =>
      applyActions(state, [
        SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(
          updateActionsWithoutUpdatingActiveNode,
        ),
      ]),
    );

    let { activeNodeId } = enforceSkeletonTracing(newState3.annotation);
    expect(activeNodeId).toBe(null);

    const updateActiveNodeAction = updateActions[2];
    const newState4 = transformStateAsReadOnly(newState, (state) =>
      applyActions(state, [
        SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction([updateActiveNodeAction]),
      ]),
    );

    activeNodeId = enforceSkeletonTracing(newState4.annotation).activeNodeId;
    expect(activeNodeId).toBe(1);
  });

  it("should clear the active node and active tree if the active tree was deleted", () => {
    const createNode = SkeletonTracingActions.createNodeAction(
      position,
      null,
      rotation,
      viewport,
      mag,
    );
    const newState = applyActions(initialState, [
      createNode, // nodeId=1
      createNode, // nodeId=2
      SkeletonTracingActions.setActiveTreeAction(2),
    ]); // active tree: 2, active bode: null
    expect(getActiveTree(enforceSkeletonTracing(newState.annotation))?.treeId).toBe(2);

    // newState2 has active tree: 2, active node: null
    const newState2 = applyActions(newState, [SkeletonTracingActions.deleteTreeAction(2)]);

    const updateActions = addMissingTimestampProp(
      Array.from(
        diffSkeletonTracing(newState.annotation.skeleton!, newState2.annotation.skeleton!),
      ),
    );

    const newState3 = transformStateAsReadOnly(newState, (state) =>
      applyActions(state, [
        SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
      ]),
    );

    const { activeTreeId, activeNodeId } = enforceSkeletonTracing(newState3.annotation);

    expect(activeNodeId).toBe(1);
    expect(activeTreeId).toBe(1);
  });

  afterAll(() => {
    // Ensure that each possible action is included in the testing at least once
    expect(seenActionTypes).toEqual(new Set(actionNamesList));
  });
});

function _debugLogTrees(prefix: string, state: WebknossosState) {
  const size = state.annotation.skeleton!.trees.getOrThrow(1).nodes.size();
  console.log("logTrees. size", size);
  for (const tree of state.annotation.skeleton!.trees.values()) {
    console.log(
      `${prefix}. tree.id=${tree.treeId}.`,
      "edges: ",
      Array.from(tree.edges.values().map((edge) => `${edge.source}-${edge.target}`)).join(", "),
      "nodes: ",
      Array.from(tree.nodes.values().map((n) => n.id)).join(", "),
    );
  }
}

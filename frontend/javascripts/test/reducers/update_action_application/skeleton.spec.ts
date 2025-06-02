import update from "immutability-helper";
import { initialState as defaultState } from "test/fixtures/hybridtracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import type { Vector3 } from "viewer/constants";
import {
  enforceSkeletonTracing,
  getActiveNode,
  getActiveTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import * as SkeletonTracingActions from "viewer/model/actions/skeletontracing_actions";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import type { ApplicableSkeletonUpdateAction } from "viewer/model/sagas/update_actions";
import type { WebknossosState } from "viewer/store";
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
    annotationType: { $set: "Explorational" },
  },
});

const position = [10, 10, 10] as Vector3;
const rotation = [0.5, 0.5, 0.5] as Vector3;
const viewport = 0;
const mag = 0;

const applyActions = chainReduce(SkeletonTracingReducer);

describe("Update Action Application for SkeletonTracing", () => {
  it("should add a new node", () => {
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
      createNode, // 3
      createNode, // 4
      createNode, // 5
      SkeletonTracingActions.deleteNodeAction(3),
      SkeletonTracingActions.createTreeAction(),
      createNode, // 6
      createNode, // 7
      createNode, // 8
      SkeletonTracingActions.setTreeNameAction("Special Name", 1),
      SkeletonTracingActions.mergeTreesAction(5, 7),
      SkeletonTracingActions.setActiveNodeAction(null),
    ]);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);

    expect(newSkeletonTracing.trees.size()).toBe(3);

    const updateActions = Array.from(
      diffSkeletonTracing(initialState.annotation.skeleton!, newSkeletonTracing),
    ) as ApplicableSkeletonUpdateAction[];

    const reappliedNewState = applyActions(initialState, [
      SkeletonTracingActions.applySkeletonUpdateActionsFromServerAction(updateActions),
      SkeletonTracingActions.setActiveNodeAction(null),
    ]);

    console.log("cachedMaxNodeId", reappliedNewState.annotation.skeleton!.cachedMaxNodeId);

    expect(reappliedNewState).toEqual(newState);
  });

  it("should clear the active node if it was deleted", () => {
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

  it("should clear the active node and active tree if the active tree was deleted", () => {
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
});

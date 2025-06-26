import update from "immutability-helper";
import _ from "lodash";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultVolumeState } from "test/fixtures/volumetracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import type { Action } from "viewer/model/actions/actions";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import * as VolumeTracingActions from "viewer/model/actions/volumetracing_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/volumetracing_saga";
import type {
  ApplicableVolumeUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/update_actions";
import { combinedReducer, type WebknossosState } from "viewer/store";
import { makeBasicGroupObject } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { afterAll, describe, expect, test } from "vitest";
import { applyActionsOnReadOnlyVersion } from "test/helpers/utils";

const enforceVolumeTracing = (state: WebknossosState) => {
  const tracing = state.annotation.volumes[0];
  if (tracing == null || state.annotation.volumes.length !== 1) {
    throw new Error("No volume tracing found");
  }
  return tracing;
};

const initialState: WebknossosState = update(defaultVolumeState, {
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

const { tracingId } = initialState.annotation.volumes[0];

const applyActions = chainReduce(combinedReducer);

// This helper dict exists so that we can ensure via typescript that
// the list contains all members of ApplicableVolumeUpdateAction. As soon as
// ApplicableVolumeUpdateAction is extended with another action, TS will complain
// if the following dictionary doesn't contain that action.
const actionNamesHelper: Record<ApplicableVolumeUpdateAction["name"], true> = {
  updateLargestSegmentId: true,
  updateSegment: true,
  createSegment: true,
  deleteSegment: true,
  updateSegmentGroups: true,
  addUserBoundingBoxInVolumeTracing: true,
  updateUserBoundingBoxInVolumeTracing: true,
  deleteUserBoundingBoxInVolumeTracing: true,
  updateSegmentGroupsExpandedState: true,
  updateUserBoundingBoxVisibilityInVolumeTracing: true,
};
const actionNamesList = Object.keys(actionNamesHelper);

describe("Update Action Application for VolumeTracing", () => {
  const seenActionTypes = new Set<string>();

  /*
   * Hardcode these values if you want to focus on a specific test.
   */
  const compactionModes = [true, false];
  const hardcodedBeforeVersionIndex: number | null = null;
  const hardcodedAfterVersionIndex: number | null = null;

  const userActions: Action[] = [
    VolumeTracingActions.updateSegmentAction(2, { somePosition: [1, 2, 3] }, tracingId),
    VolumeTracingActions.updateSegmentAction(3, { somePosition: [3, 4, 5] }, tracingId),
    VolumeTracingActions.updateSegmentAction(
      3,
      {
        name: "name",
        groupId: 3,
        metadata: [
          {
            key: "someKey",
            stringValue: "some string value",
          },
        ],
      },
      tracingId,
    ),
    addUserBoundingBoxAction({
      boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
      name: "UserBBox",
      color: [1, 2, 3],
      isVisible: true,
    }),
    changeUserBoundingBoxAction(1, { name: "Updated Name" }),
    deleteUserBoundingBoxAction(1),
    VolumeTracingActions.setSegmentGroupsAction(
      [makeBasicGroupObject(3, "group 3"), makeBasicGroupObject(7, "group 7")],
      tracingId,
    ),
    VolumeTracingActions.removeSegmentAction(3, tracingId),
    VolumeTracingActions.setLargestSegmentIdAction(10000),
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
            VolumeTracingActions.setActiveCellAction(0),
            setActiveUserBoundingBoxId(null),
          ]);

          const actionsToApply = userActions.slice(beforeVersionIndex, afterVersionIndex + 1);
          const state3 = applyActions(
            state2WithActiveTree,
            actionsToApply.concat([
              VolumeTracingActions.setActiveCellAction(0),
              setActiveUserBoundingBoxId(null),
            ]),
          );
          expect(state2WithoutActiveState !== state3).toBeTruthy();

          const volumeTracing2 = enforceVolumeTracing(state2WithoutActiveState);
          const volumeTracing3 = enforceVolumeTracing(state3);

          const updateActionsBeforeCompaction = Array.from(
            diffVolumeTracing(volumeTracing2, volumeTracing3),
          );
          const maybeCompact = withCompaction
            ? compactUpdateActions
            : (updateActions: UpdateActionWithoutIsolationRequirement[]) => updateActions;
          const updateActions = maybeCompact(
            updateActionsBeforeCompaction,
            volumeTracing2,
            volumeTracing3,
          ) as ApplicableVolumeUpdateAction[];

          for (const action of updateActions) {
            seenActionTypes.add(action.name);
          }

          const reappliedNewState = applyActionsOnReadOnlyVersion(
            applyActions,
            state2WithoutActiveState,
            [
              VolumeTracingActions.applyVolumeUpdateActionsFromServerAction(updateActions),
              VolumeTracingActions.setActiveCellAction(0),
              setActiveUserBoundingBoxId(null),
            ],
          );

          expect(reappliedNewState).toEqual(state3);
        });
      });
    },
  );

  afterAll(() => {
    expect(seenActionTypes).toEqual(new Set(actionNamesList));
  });
});

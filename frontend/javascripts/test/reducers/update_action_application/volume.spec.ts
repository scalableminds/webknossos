import update from "immutability-helper";
import range from "lodash-es/range";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultVolumeState } from "test/fixtures/volumetracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import type { Action } from "viewer/model/actions/actions";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import {
  applyVolumeUpdateActionsFromServerAction,
  createCellAction,
  removeSegmentAction,
  setActiveCellAction,
  setLargestSegmentIdAction,
  setSegmentGroupsAction,
  toggleSegmentGroupAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/volumetracing_saga";
import type {
  ApplicableVolumeUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import { combinedReducer, type WebknossosState } from "viewer/store";
import { makeBasicGroupObject } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { afterAll, describe, expect, test } from "vitest";
import { transformStateAsReadOnly } from "test/helpers/utils";

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
  updateActiveSegmentId: true,
  updateSegmentVisibility: true,
  updateSegmentGroupVisibility: true,
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
    updateSegmentAction(2, { somePosition: [1, 2, 3] }, tracingId),
    updateSegmentAction(3, { somePosition: [3, 4, 5] }, tracingId),
    updateSegmentAction(
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
    setSegmentGroupsAction(
      [makeBasicGroupObject(3, "group 3"), makeBasicGroupObject(7, "group 7")],
      tracingId,
    ),
    updateSegmentAction(3, { isVisible: false }, tracingId),
    // Needs to be visible again for the toggleSegmentGroupAction to turn all segments invisible and thus trigger a compact updateSegmentGroupVisibilityAction.
    updateSegmentAction(3, { isVisible: true }, tracingId),
    // The group with id 3 needs at least one visible cells for the reducer to make to toggle it.
    updateSegmentAction(2, { groupId: 3 }, tracingId),
    // Moreover, at least two are needed to make the compaction evict a updateSegmentGroupVisibilityAction.
    createCellAction(4, 4),
    setActiveCellAction(4),
    updateSegmentAction(4, { groupId: 3, somePosition: [7, 8, 9], isVisible: true }, tracingId),
    toggleSegmentGroupAction(3, tracingId),
    removeSegmentAction(3, tracingId),
    setLargestSegmentIdAction(10000),
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
      : range(0, userActions.length);

  describe.each(compactionModes)(
    "[Compaction=%s]: should re-apply update actions from complex diff and get same state",
    (withCompaction) => {
      describe.each(beforeVersionIndices)("From v=%i", (beforeVersionIndex: number) => {
        const afterVersionIndices =
          hardcodedAfterVersionIndex != null
            ? [hardcodedAfterVersionIndex]
            : range(beforeVersionIndex, userActions.length + 1);

        test.each(afterVersionIndices)("To v=%i", (afterVersionIndex: number) => {
          const state2WithActiveCell = applyActions(
            initialState,
            userActions.slice(0, beforeVersionIndex),
          );

          const state2WithoutActiveBoundingBox = applyActions(state2WithActiveCell, [
            setActiveUserBoundingBoxId(null),
          ]);

          const actionsToApply = userActions.slice(beforeVersionIndex, afterVersionIndex + 1);
          const state3 = applyActions(
            state2WithActiveCell,
            actionsToApply.concat([setActiveUserBoundingBoxId(null)]),
          );
          expect(state2WithoutActiveBoundingBox !== state3).toBeTruthy();

          const volumeTracing2 = enforceVolumeTracing(state2WithoutActiveBoundingBox);
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

          let reappliedNewState = transformStateAsReadOnly(
            state2WithoutActiveBoundingBox,
            (state) =>
              applyActions(state, [
                applyVolumeUpdateActionsFromServerAction(updateActions),
                setActiveUserBoundingBoxId(null),
              ]),
          );

          // fixing activeUnmappedSegmentId mismatch as the frontend supports a createCellAction,
          // which sets activeUnmappedSegmentId to null but the matching annotation update action equivalent
          // "updateActiveSegmentId" sets activeUnmappedSegmentId to undefined.
          if (
            reappliedNewState.annotation.volumes[0].activeUnmappedSegmentId == null &&
            state3.annotation.volumes[0].activeUnmappedSegmentId == null
          ) {
            reappliedNewState = update(reappliedNewState, {
              annotation: {
                volumes: {
                  [0]: {
                    activeUnmappedSegmentId: {
                      $set: state3.annotation.volumes[0].activeUnmappedSegmentId,
                    },
                  },
                },
              },
            });
          }

          expect(reappliedNewState.annotation.volumes[0]).toEqual(state3.annotation.volumes[0]);
        });
      });
    },
  );

  afterAll(() => {
    expect(seenActionTypes).toEqual(new Set(actionNamesList));
  });
});

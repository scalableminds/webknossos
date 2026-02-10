import update from "immutability-helper";
import range from "lodash-es/range";
import { sampleTracingLayer } from "test/fixtures/dataset_server_object";
import { initialState as defaultVolumeState } from "test/fixtures/volumetracing_object";
import { chainReduce } from "test/helpers/chainReducer";
import { transformStateAsReadOnly } from "test/helpers/utils";
import {
  MOVE_GROUP_EDGE_CASE,
  SEGMENT_GROUPS,
  SEGMENT_GROUPS_EDITED,
  SWAP_GROUP_EDGE_CASE,
} from "test/sagas/volumetracing/segment_group_fixtures";
import type { Action } from "viewer/model/actions/actions";
import {
  addUserBoundingBoxAction,
  changeUserBoundingBoxAction,
  deleteUserBoundingBoxAction,
} from "viewer/model/actions/annotation_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import {
  applyVolumeUpdateActionsFromServerAction,
  createCellAction,
  mergeSegmentsAction,
  removeSegmentAction,
  setActiveCellAction,
  setLargestSegmentIdAction,
  setSegmentGroupsAction,
  toggleSegmentGroupAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import compactUpdateActions from "viewer/model/helpers/compaction/compact_update_actions";
import type {
  ApplicableVolumeServerUpdateAction,
  ApplicableVolumeUpdateAction,
  UpdateActionWithoutIsolationRequirement,
} from "viewer/model/sagas/volume/update_actions";
import { diffVolumeTracing } from "viewer/model/sagas/volume/volume_diffing";
import { combinedReducer, type WebknossosState } from "viewer/store";
import { makeBasicGroupObject } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { afterAll, describe, expect, it, test } from "vitest";

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

const addMissingTimestampProp = (
  actions: UpdateActionWithoutIsolationRequirement[],
): ApplicableVolumeServerUpdateAction[] => {
  return actions.map(
    (a) =>
      ({
        ...a,
        value: { ...a.value, actionTimestamp: 0 },
      }) as ApplicableVolumeServerUpdateAction,
  );
};

const { tracingId } = initialState.annotation.volumes[0];

const applyActions = chainReduce(combinedReducer);

// This helper dict exists so that we can ensure via typescript that
// the list contains all members of ApplicableVolumeUpdateAction. As soon as
// ApplicableVolumeUpdateAction is extended with another action, TS will complain
// if the following dictionary doesn't contain that action.
const actionNamesHelper: Record<ApplicableVolumeUpdateAction["name"], true> = {
  updateLargestSegmentId: true,
  updateSegmentPartial: true,
  createSegment: true,
  mergeSegments: true,
  deleteSegment: true,
  upsertSegmentGroup: true,
  deleteSegmentGroup: true,
  updateMetadataOfSegment: true,
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
  const compactionModes = [false, true];
  const hardcodedBeforeVersionIndex: number | null = null;
  const hardcodedAfterVersionIndex: number | null = null;

  const userActions: Action[] = [
    updateSegmentAction(2, { anchorPosition: [1, 2, 3] }, tracingId),
    updateSegmentAction(3, { anchorPosition: [3, 4, 5] }, tracingId),
    updateSegmentAction(
      3,
      {
        name: "name",
        groupId: 3,
        metadata: [
          {
            key: "someKey1",
            stringValue: "some string value (will be changed later)",
          },
          {
            key: "someKey2",
            stringValue: "will be deleted later",
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
    updateSegmentAction(4, { groupId: 3, anchorPosition: [7, 8, 9], isVisible: true }, tracingId),
    toggleSegmentGroupAction(3, tracingId),
    updateSegmentAction(
      3,
      {
        metadata: [
          {
            key: "someKey1",
            stringValue: "changed",
          },
          {
            key: "someKey3",
            stringValue: "added",
          },
        ],
      },
      tracingId,
    ),
    mergeSegmentsAction(3, 2, tracingId),
    removeSegmentAction(3, tracingId),
    setLargestSegmentIdAction(10000),
    setSegmentGroupsAction([makeBasicGroupObject(3, "group 3 - renamed")], tracingId),
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

  describe.each(
    compactionModes,
  )("[Compaction=%s]: should re-apply update actions from complex diff and get same state", (withCompaction) => {
    describe.each(beforeVersionIndices)("From v=%i", (beforeVersionIndex: number) => {
      const afterVersionIndices =
        hardcodedAfterVersionIndex != null
          ? [hardcodedAfterVersionIndex]
          : range(beforeVersionIndex, userActions.length + 1);

      test.each(afterVersionIndices)("To v=%i", (afterVersionIndex: number) => {
        // The update actions are applied on the initialState which produces new states.
        // The "timeline" is as follows:
        //         initialState
        //              ↓
        // [actions until beforeVersionIndex]
        //              ↓
        //            state2
        //              ↓
        // [actions between before and afterVersionIndex]
        //              ↓
        //            state3
        //
        // state2 and state3 are diffed and that diff is applied again on state2.
        // The result is compared against state3 again.
        const state2WithActiveCell = applyActions(
          initialState,
          userActions.slice(0, beforeVersionIndex),
        );

        const state2WithoutActiveBoundingBox = applyActions(state2WithActiveCell, [
          setActiveUserBoundingBoxId(null),
        ]);

        const actionsToApply = userActions.slice(beforeVersionIndex, afterVersionIndex + 1);
        let state3 = applyActions(
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
        const updateActions = addMissingTimestampProp(
          maybeCompact(updateActionsBeforeCompaction, volumeTracing2, volumeTracing3),
        );

        for (const action of updateActions) {
          seenActionTypes.add(action.name);
        }

        let reappliedNewState = transformStateAsReadOnly(state2WithoutActiveBoundingBox, (state) =>
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
  });

  it("should be able to apply actions basic group editing", () => {
    const state1 = applyActions(initialState, [setSegmentGroupsAction(SEGMENT_GROUPS, tracingId)]);
    const state2 = applyActions(state1, [setSegmentGroupsAction(SEGMENT_GROUPS_EDITED, tracingId)]);

    const volumeTracing1 = enforceVolumeTracing(state1);
    const volumeTracing2 = enforceVolumeTracing(state2);

    const updateActions = addMissingTimestampProp(
      Array.from(diffVolumeTracing(volumeTracing1, volumeTracing2)),
    );

    let reappliedNewState = transformStateAsReadOnly(state1, (state) =>
      applyActions(state, [
        applyVolumeUpdateActionsFromServerAction(updateActions),
        setActiveUserBoundingBoxId(null),
      ]),
    );

    expect(reappliedNewState.annotation.volumes[0]).toEqual(state2.annotation.volumes[0]);
  });

  it("should be able to apply actions for edge case where a group is moved into one of its children", () => {
    const state1 = applyActions(initialState, [
      setSegmentGroupsAction(MOVE_GROUP_EDGE_CASE.BEFORE, tracingId),
    ]);

    const state2 = applyActions(state1, [
      setSegmentGroupsAction(MOVE_GROUP_EDGE_CASE.AFTER, tracingId),
    ]);

    const volumeTracing1 = enforceVolumeTracing(state1);
    const volumeTracing2 = enforceVolumeTracing(state2);

    const updateActions = addMissingTimestampProp(
      Array.from(diffVolumeTracing(volumeTracing1, volumeTracing2)),
    );

    let reappliedNewState = transformStateAsReadOnly(state1, (state) =>
      applyActions(state, [
        applyVolumeUpdateActionsFromServerAction(updateActions),
        setActiveUserBoundingBoxId(null),
      ]),
    );

    expect(reappliedNewState.annotation.volumes[0]).toEqual(state2.annotation.volumes[0]);
  });

  it("should be able to apply actions for edge case where two groups are swapped", () => {
    const state1 = applyActions(initialState, [
      setSegmentGroupsAction(SWAP_GROUP_EDGE_CASE.BEFORE, tracingId),
    ]);

    const state2 = applyActions(state1, [
      setSegmentGroupsAction(SWAP_GROUP_EDGE_CASE.AFTER, tracingId),
    ]);

    const volumeTracing1 = enforceVolumeTracing(state1);
    const volumeTracing2 = enforceVolumeTracing(state2);

    const updateActions = addMissingTimestampProp(
      Array.from(diffVolumeTracing(volumeTracing1, volumeTracing2)),
    );

    let reappliedNewState = transformStateAsReadOnly(state1, (state) =>
      applyActions(state, [
        applyVolumeUpdateActionsFromServerAction(updateActions),
        setActiveUserBoundingBoxId(null),
      ]),
    );

    expect(reappliedNewState.annotation.volumes[0]).toEqual(state2.annotation.volumes[0]);
  });

  afterAll(() => {
    expect(seenActionTypes).toEqual(new Set(actionNamesList));
  });
});

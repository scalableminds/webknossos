import {
  createSegment1,
  createSegment2,
  createSegment3,
  id1,
  id2,
  id3,
} from "test/fixtures/segment_merging_fixtures";
import { initialState, VOLUME_TRACING_ID } from "test/fixtures/volumetracing_object";
import type { MetadataEntryProto } from "types/api_types";
import {
  mergeSegmentsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import VolumeTracingReducer from "viewer/model/reducers/volumetracing_reducer";
import {
  diffMetadataOfSegments,
  diffSegmentGroups,
  uncachedDiffSegmentLists,
} from "viewer/model/sagas/diffing/volume_diffing";
import { updateMetadataOfSegmentUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { Segment } from "viewer/store";
import { describe, expect, it, test } from "vitest";
import {
  MOVE_GROUP_EDGE_CASE,
  SEGMENT_GROUPS,
  SEGMENT_GROUPS_EDITED,
} from "./segment_group_fixtures";

const createSegment = (
  id: number,
  groupId: number | null,
  metadata: MetadataEntryProto[],
): Segment => ({
  id,
  name: "TestSegment",
  color: [23, 23, 23],
  creationTime: 12345678,
  anchorPosition: [0, 0, 0],
  isVisible: false,
  additionalCoordinates: [],
  groupId,
  metadata,
});

const tracingId = "someTracingId";

describe("diffMetadataOfSegments for volume tracings", () => {
  it("diffMetadataOfSegments should detect added, changed and removed metadata", () => {
    const segment1 = createSegment(1, 0, [
      { key: "keyToDelete", stringValue: "string 0" },
      {
        key: "keyToChange1",
        numberValue: 3,
      },
      {
        key: "keyToChange2",
        stringValue: "some string",
      },
    ]);
    const segment2 = {
      ...segment1,
      metadata: [
        {
          key: "keyToChange1",
          boolValue: true,
        },
        {
          key: "keyToChange2",
          stringValue: "some string 2",
        },
        {
          key: "addedKey1",
          stringValue: "string 1",
        },
        {
          key: "addedKey2",
          numberValue: 3,
        },
        {
          key: "addedKey3",
          stringListValue: ["string1"],
        },
      ],
    };
    const updateActions = Array.from(diffMetadataOfSegments(segment2, segment1, tracingId));

    expect(updateActions.length).toEqual(1);
    expect(updateActions[0]).toEqual(
      updateMetadataOfSegmentUpdateAction(
        segment1.id,
        segment2.metadata,
        ["keyToDelete"],
        tracingId,
      ),
    );
  });
});

describe("diffSegmentGroups for volume tracings", () => {
  it("diffSegmentGroups should detect zero changes if nothing changed", () => {
    const updateActions = Array.from(
      diffSegmentGroups(
        SEGMENT_GROUPS,
        SEGMENT_GROUPS.slice(), // use slice to get another identity
        tracingId,
      ),
    );

    expect(updateActions.length).toEqual(0);
  });

  it("diffSegmentGroups should detect added, changed and deleted groups", () => {
    // Delete group id 4
    // Rename group id 1
    // Move group id 3 so that it is a parent of group id 2

    const updateActions = Array.from(
      diffSegmentGroups(SEGMENT_GROUPS, SEGMENT_GROUPS_EDITED.slice(), tracingId),
    );
    expect(updateActions.length).toEqual(3);

    expect(updateActions).toEqual([
      {
        name: "deleteSegmentGroup",
        value: { groupId: 4, actionTracingId: "someTracingId" },
      },
      {
        name: "upsertSegmentGroup",
        value: { groupId: 3, actionTracingId: "someTracingId", newParentId: 2 },
      },
      {
        name: "upsertSegmentGroup",
        value: {
          groupId: 1,
          actionTracingId: "someTracingId",
          name: "subroot1 - renamed",
        },
      },
    ]);
  });

  it("diffSegmentGroups should handle case where a group gets moved into one of its subgroups", () => {
    /* Given:
     * 1
     *   3
     *     4
     *   2
     * Move 1 into 3. 2 should still be a child of 1.
     * Afterwards:
     * 3
     *   4
     *   1
     *     2
     */

    const updateActions = Array.from(
      diffSegmentGroups(MOVE_GROUP_EDGE_CASE.BEFORE, MOVE_GROUP_EDGE_CASE.AFTER, tracingId),
    );
    expect(updateActions).toEqual([
      {
        name: "upsertSegmentGroup",
        value: { groupId: 3, actionTracingId: "someTracingId", newParentId: -1 },
      },
      {
        name: "upsertSegmentGroup",
        value: { groupId: 1, actionTracingId: "someTracingId", newParentId: 3 },
      },
    ]);
  });
});

describe("uncachedDiffSegmentLists should diff segment lists", () => {
  // Each list defines which segment itesm should already exist before
  // the merge is executed.
  describe.for([
    [],
    [id1, id2],
    [id1],
    [id2],
  ])("mergeSegment actions should be detected during diffing", (segmentItemsToCreateInSetup) => {
    test(`with prepared segments: [${segmentItemsToCreateInSetup}]`, () => {
      let newState = initialState;
      if (segmentItemsToCreateInSetup.includes(id1)) {
        newState = VolumeTracingReducer(newState, createSegment1);
      }
      if (segmentItemsToCreateInSetup.includes(id2)) {
        newState = VolumeTracingReducer(newState, createSegment2);
      }
      const stateBeforeMerge = newState;
      newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));
      const stateAfterMerge = newState;

      const prevVolumeTracing = stateBeforeMerge.annotation.volumes[0];
      const volumeTracing = stateAfterMerge.annotation.volumes[0];

      const updateActions = Array.from(
        uncachedDiffSegmentLists(
          VOLUME_TRACING_ID,
          prevVolumeTracing.segments,
          volumeTracing.segments,
          prevVolumeTracing.segmentJournal,
          volumeTracing.segmentJournal,
        ),
      );

      expect(updateActions).toEqual([
        {
          name: "mergeSegments",
          value: {
            actionTracingId: VOLUME_TRACING_ID,
            sourceId: id1,
            targetId: id2,
          },
        },
      ]);
    });
  });

  test("mergeSegments should be detected along with another segment update", () => {
    let newState = initialState;
    newState = VolumeTracingReducer(newState, createSegment1);
    newState = VolumeTracingReducer(newState, createSegment2);

    const newSegmentPartial = {
      metadata: [
        { key: "someKey1", stringValue: "someStringValue - segment 1 - changed" },
        { key: "someKey4", boolValue: true },
      ],
    };

    const stateBeforeMerge = newState;
    newState = VolumeTracingReducer(
      newState,
      updateSegmentAction(id1, newSegmentPartial, VOLUME_TRACING_ID),
    );

    newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));

    const stateAfterMerge = newState;

    const prevVolumeTracing = stateBeforeMerge.annotation.volumes[0];
    const volumeTracing = stateAfterMerge.annotation.volumes[0];

    const updateActions = Array.from(
      uncachedDiffSegmentLists(
        VOLUME_TRACING_ID,
        prevVolumeTracing.segments,
        volumeTracing.segments,
        prevVolumeTracing.segmentJournal,
        volumeTracing.segmentJournal,
      ),
    );

    /*
     * Only applying mergeSegments on the initial segment items, would produce
        { key: "someKey1-1", stringValue: "someStringValue - segment 1" },
        { key: "someKey2", stringListValue: ["list", "value", "segment 1"] },

        { key: "someKey1-2", stringValue: "someStringValue - segment 2" },
        { key: "someKey3", stringListValue: ["list", "value", "segment 2"] },
        { key: "identicalKey", stringValue: "identicalValue" },
     * However, segment 1 was edited before the merge.
     * Therefore, we need another update action which transforms from the above
     * to this (note that the last 3 lines are identical):
        { key: "someKey1-1", stringValue: "someStringValue - segment 1 - changed" },
        { key: "someKey4", boolValue: true },

        { key: "someKey1-2", stringValue: "someStringValue - segment 2" },
        { key: "someKey3", stringListValue: ["list", "value", "segment 2"] },
        { key: "identicalKey", stringValue: "identicalValue" },
     */
    expect(updateActions).toEqual([
      {
        name: "mergeSegments",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          sourceId: id1,
          targetId: id2,
        },
      },
      {
        name: "updateMetadataOfSegment",
        value: {
          actionTracingId: "volumeTracingId",
          id: 1,
          removeEntriesByKey: ["someKey2"],
          upsertEntriesByKey: [
            { key: "someKey1-1", stringValue: "someStringValue - segment 1 - changed" },
            { key: "someKey4", boolValue: true },
          ],
        },
      },
    ]);
  });

  test("multiple mergeSegments actions should be detected", () => {
    let newState = initialState;
    newState = VolumeTracingReducer(newState, createSegment1);
    newState = VolumeTracingReducer(newState, createSegment2);
    newState = VolumeTracingReducer(newState, createSegment3);

    const stateBeforeMerge = newState;
    newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id2, VOLUME_TRACING_ID));
    newState = VolumeTracingReducer(newState, mergeSegmentsAction(id1, id3, VOLUME_TRACING_ID));
    const stateAfterMerge = newState;

    const prevVolumeTracing = stateBeforeMerge.annotation.volumes[0];
    const volumeTracing = stateAfterMerge.annotation.volumes[0];

    const updateActions = Array.from(
      uncachedDiffSegmentLists(
        VOLUME_TRACING_ID,
        prevVolumeTracing.segments,
        volumeTracing.segments,
        prevVolumeTracing.segmentJournal,
        volumeTracing.segmentJournal,
      ),
    );

    expect(updateActions).toEqual([
      {
        name: "mergeSegments",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          sourceId: id1,
          targetId: id2,
        },
      },
      {
        name: "mergeSegments",
        value: {
          actionTracingId: VOLUME_TRACING_ID,
          sourceId: id1,
          targetId: id3,
        },
      },
    ]);
  });
});

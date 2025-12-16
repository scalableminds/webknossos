import type { MetadataEntryProto } from "types/api_types";
import { updateMetadataOfSegmentUpdateAction } from "viewer/model/sagas/volume/update_actions";
import {
  diffMetadataOfSegments,
  diffSegmentGroups,
} from "viewer/model/sagas/volume/volume_diffing";
import type { Segment } from "viewer/store";
import { describe, expect, it } from "vitest";
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
        value: {
          groupId: 1,
          actionTracingId: "someTracingId",
          name: "subroot1 - renamed",
        },
      },
      {
        name: "upsertSegmentGroup",
        value: { groupId: 3, actionTracingId: "someTracingId", parentGroupId: 2 },
      },
    ]);
  });

  it("diffSegmentGroups should handle case where a group gets moved into one of its subgroups", () => {
    /* Given:
     * 1
     *   3
     *     4
     *   2
     * Move 1 into 3. 2 should still be parent of 1 AFTERwards:
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
        value: { groupId: 1, actionTracingId: "someTracingId", parentGroupId: 3 },
      },
      {
        name: "upsertSegmentGroup",
        value: { groupId: 3, actionTracingId: "someTracingId", parentGroupId: -1 },
      },
    ]);
  });
});

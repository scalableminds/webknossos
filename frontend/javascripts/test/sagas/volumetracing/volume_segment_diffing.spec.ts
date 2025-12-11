import type { MetadataEntryProto } from "types/api_types";
import { updateMetadataOfSegmentUpdateAction } from "viewer/model/sagas/volume/update_actions";
import { diffMetadataOfSegments } from "viewer/model/sagas/volumetracing_saga";
import type { Segment } from "viewer/store";
import { describe, expect, it } from "vitest";

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

// const genericGroups: TreeGroup[] = [
//   {
//     name: "subroot1",
//     groupId: 1,
//     children: [
//       {
//         name: "subsubroot1",
//         groupId: 3,
//         children: [
//           {
//             name: "subsubsubroot1",
//             groupId: 4,
//             children: [],
//           },
//         ],
//       },
//     ],
//   },
//   {
//     name: "subroot2",
//     groupId: 2,
//     children: [],
//   },
// ];
const tracingId = "someTracingId";

describe("diffMetadataOfSegments for volume tracings", () => {
  it("diffMetadataOfSegments should detect added, changed and[] removed metadata", () => {
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

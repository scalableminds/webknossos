import DiffableMap from "libs/diffable_map";
import type { Segment, SegmentGroup } from "viewer/store";
import {
  buildSegmentHierarchy,
  getSegmentIdsInRange,
} from "viewer/view/right_border_tabs/segments_tab/hierarchy";
import { describe, expect, it } from "vitest";

const createSegment = (id: bigint, groupId: number | null): Segment => ({
  id,
  name: null,
  color: null,
  creationTime: 0,
  anchorPosition: [0, 0, 0],
  isVisible: true,
  additionalCoordinates: [],
  groupId,
  metadata: [],
});

const segmentGroups: SegmentGroup[] = [{ name: "Group 1", groupId: 1, children: [] }];
const segments = [1n, 2n, 3n, 4n, 5n].map((id) => createSegment(id, null));
segments.push(createSegment(10n, 1), createSegment(11n, 1));
const hierarchy = buildSegmentHierarchy(
  new DiffableMap(segments.map((segment) => [segment.id, segment])),
  segmentGroups,
);

describe("getSegmentIdsInRange", () => {
  it("should select all segments between anchor and target (inclusive)", () => {
    expect(getSegmentIdsInRange(hierarchy, 2n, 4n)).toEqual([2n, 3n, 4n]);
  });

  it("should work when the target comes before the anchor", () => {
    expect(getSegmentIdsInRange(hierarchy, 5n, 1n)).toEqual([1n, 2n, 3n, 4n, 5n]);
  });

  it("should return the single segment when anchor and target are equal", () => {
    expect(getSegmentIdsInRange(hierarchy, 3n, 3n)).toEqual([3n]);
  });

  it("should work within a nested group", () => {
    expect(getSegmentIdsInRange(hierarchy, 11n, 10n)).toEqual([10n, 11n]);
  });

  it("should return null for segments in different groups", () => {
    expect(getSegmentIdsInRange(hierarchy, 1n, 10n)).toBeNull();
  });

  it("should return null for unknown segments", () => {
    expect(getSegmentIdsInRange(hierarchy, 1n, 99n)).toBeNull();
  });
});

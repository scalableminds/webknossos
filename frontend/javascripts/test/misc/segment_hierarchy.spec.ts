import DiffableMap from "libs/diffable_map";
import type { Segment, SegmentGroup } from "viewer/store";
import {
  buildSegmentHierarchy,
  findSegmentToSelectAfterRemoval,
} from "viewer/view/right_border_tabs/segments_tab/hierarchy";
import { describe, expect, it } from "vitest";

const makeSegment = (id: number, groupId: number | null = null): Segment => ({
  id: BigInt(id),
  name: null,
  creationTime: 0,
  color: null,
  groupId,
  isVisible: true,
  metadata: [],
});

const makeHierarchy = (segments: Segment[], segmentGroups: SegmentGroup[] = []) =>
  buildSegmentHierarchy(new DiffableMap(segments.map((s) => [s.id, s])), segmentGroups);

const nextIdAfterRemoving = (
  hierarchy: ReturnType<typeof makeHierarchy>,
  removedIds: number[],
): bigint | null =>
  findSegmentToSelectAfterRemoval(hierarchy, removedIds.map(BigInt))?.segment.id ?? null;

describe("findSegmentToSelectAfterRemoval", () => {
  const hierarchy = makeHierarchy([1, 2, 3, 4, 5].map((id) => makeSegment(id)));

  it("selects the segment below the removed one", () => {
    expect(nextIdAfterRemoving(hierarchy, [2])).toBe(3n);
  });

  it("selects the first remaining segment below a multi-selection", () => {
    expect(nextIdAfterRemoving(hierarchy, [2, 3])).toBe(4n);
    expect(nextIdAfterRemoving(hierarchy, [2, 4])).toBe(5n);
  });

  it("falls back to the segment above if the removed ones are at the end", () => {
    expect(nextIdAfterRemoving(hierarchy, [5])).toBe(4n);
    expect(nextIdAfterRemoving(hierarchy, [4, 5])).toBe(3n);
  });

  it("returns null if all segments are removed or none of the removed ones is rendered", () => {
    expect(nextIdAfterRemoving(hierarchy, [1, 2, 3, 4, 5])).toBeNull();
    expect(nextIdAfterRemoving(hierarchy, [42])).toBeNull();
  });

  it("only considers segments of expanded groups", () => {
    const groups: SegmentGroup[] = [
      { name: "collapsed", groupId: 1, children: [], isExpanded: false },
    ];
    const withGroup = makeHierarchy(
      [makeSegment(1), makeSegment(2), makeSegment(3, 1), makeSegment(4, 1)],
      groups,
    );
    // Segment 3 and 4 are not rendered, so removing 2 leaves nothing below it.
    expect(nextIdAfterRemoving(withGroup, [2])).toBe(1n);
    // Removed segments inside a collapsed group are not rendered either.
    expect(nextIdAfterRemoving(withGroup, [3])).toBeNull();
  });

  it("continues into the segments of an expanded group", () => {
    const groups: SegmentGroup[] = [{ name: "open", groupId: 1, children: [], isExpanded: true }];
    const withGroup = makeHierarchy([makeSegment(1, 1), makeSegment(2, 1), makeSegment(3)], groups);
    // Rendered order: segments of the group first, then the ungrouped segment.
    expect(nextIdAfterRemoving(withGroup, [2])).toBe(3n);
  });
});

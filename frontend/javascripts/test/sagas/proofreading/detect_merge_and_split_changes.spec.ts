import { detectMergeAndSplitChanges } from "viewer/model/sagas/volume/proofreading/local_mesh_change_sagas";
import type { AgglomerateChangeItem } from "viewer/model/sagas/volume/proofreading/proofreading_types";
import { describe, expect, it, vi } from "vitest";

// local_mesh_change_sagas.ts transitively imports precomputed_mesh_saga.ts, which instantiates a
// web worker at module load time. Mock it away like apiHelpers.ts does for the other suites.
vi.mock("libs/compute_bvh_async", () => ({
  computeBvhAsync: vi.fn().mockResolvedValue(undefined),
}));

function item(
  oldAgglomerateId: bigint | undefined,
  newAgglomerateId: bigint,
): AgglomerateChangeItem {
  return { oldAgglomerateId, newAgglomerateId, nodePosition: [0, 0, 0] };
}

describe("detectMergeAndSplitChanges", () => {
  it("detects a plain merge", () => {
    const { mergeGroups, splitGroups, remainingItems } = detectMergeAndSplitChanges([
      item(1n, 1n),
      item(4n, 1n),
    ]);
    expect(mergeGroups).toHaveLength(1);
    expect(mergeGroups[0].newAgglomerateId).toBe(1n);
    expect(mergeGroups[0].oldIds).toEqual([1n, 4n]);
    expect(splitGroups).toEqual([]);
    expect(remainingItems).toEqual([]);
  });

  it("detects a plain split", () => {
    const { mergeGroups, splitGroups, remainingItems } = detectMergeAndSplitChanges([
      item(1n, 1n),
      item(1n, 2n),
      item(1n, 3n),
    ]);
    expect(mergeGroups).toEqual([]);
    expect(splitGroups).toHaveLength(1);
    expect(splitGroups[0].oldAgglomerateId).toBe(1n);
    expect(splitGroups[0].newIds).toEqual([1n, 2n, 3n]);
    expect(remainingItems).toEqual([]);
  });

  it("does not invent a surviving id when the batch has no identity item for it", () => {
    // 1 is fully split up into 2 and 3, so it must not be added to newIds.
    const { splitGroups } = detectMergeAndSplitChanges([item(1n, 2n), item(1n, 3n)]);
    expect(splitGroups).toHaveLength(1);
    expect(splitGroups[0].newIds).toEqual([2n, 3n]);
  });

  it("passes items through that are neither a merge nor a split", () => {
    const { mergeGroups, splitGroups, remainingItems } = detectMergeAndSplitChanges([
      item(1n, 2n),
      item(undefined, 5n),
    ]);
    expect(mergeGroups).toEqual([]);
    expect(splitGroups).toEqual([]);
    expect(remainingItems).toHaveLength(2);
  });
});

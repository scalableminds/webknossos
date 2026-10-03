import PriorityQueue from "js-priority-queue";
import { M4x4, type Matrix4x4 } from "libs/mjs";
import type { Vector3, Vector4 } from "viewer/constants";
import { UnitLong } from "viewer/constants";
import { _getDummyFlycamMatrix } from "viewer/model/accessors/flycam_accessor";
import determineBucketsForPlaneByRows from "viewer/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker_rows";
import { countingSortToArrayBuffer } from "viewer/model/bucket_data_handling/bucket_priority_sort";
import { describe, expect, it } from "vitest";

type Item = { bucketAddress: Vector4; priority: number };

// Same as the bucket picker worker's priority queue path.
function sortWithPriorityQueue(items: Item[]): Uint32Array {
  const queue = new PriorityQueue<Item>({ comparator: (b, a) => b.priority - a.priority });
  for (const item of items) queue.queue(item);
  const output: number[] = [];
  while (queue.length > 0) {
    const { bucketAddress, priority } = queue.dequeue();
    output.push(...bucketAddress, priority);
  }
  return new Uint32Array(output);
}

function sortWithCountingSort(items: Item[]): Uint32Array {
  return new Uint32Array(
    countingSortToArrayBuffer(
      items.flatMap((item) => item.bucketAddress),
      items.map((item) => item.priority),
    ),
  );
}

function toSortedRecords(output: Uint32Array): string[] {
  const records: string[] = [];
  for (let i = 0; i < output.length; i += 5) records.push(output.slice(i, i + 5).join(","));
  return records.sort();
}

function expectSameOrderOfPriorities(actual: Uint32Array, expected: Uint32Array) {
  const priorities = (output: Uint32Array) => output.filter((_, i) => i % 5 === 4);
  // Buckets with equal priority may be ordered differently, but the priorities must match.
  expect([...priorities(actual)]).toEqual([...priorities(expected)]);
  expect(toSortedRecords(actual)).toEqual(toSortedRecords(expected));
}

describe("countingSortToArrayBuffer", () => {
  it("returns an empty buffer for no buckets", () => {
    expect(countingSortToArrayBuffer([], []).byteLength).toBe(0);
  });

  it("sorts like the priority queue (random input)", () => {
    let seed = 3;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const items: Item[] = [];
    for (let i = 0; i < 2000; i++) {
      items.push({
        bucketAddress: [i, Math.floor(random() * 100), Math.floor(random() * 100), i % 4],
        priority: Math.floor(random() * 40) + 1000 * (i % 4),
      });
    }
    expectSameOrderOfPriorities(sortWithCountingSort(items), sortWithPriorityQueue(items));
  });

  it("keeps the insertion order of buckets with equal priority", () => {
    const items: Item[] = [5, 3, 5, 3, 5].map((priority, i) => ({
      bucketAddress: [i, 0, 0, 0],
      priority,
    }));
    const xs = [...sortWithCountingSort(items)].filter((_, i) => i % 5 === 0);
    expect(xs).toEqual([1, 3, 0, 2, 4]);
  });

  it("sorts like the priority queue (oblique bucket picker output)", () => {
    let matrix = [
      ..._getDummyFlycamMatrix({ factor: [11, 11, 24], unit: UnitLong.nm }),
    ] as Matrix4x4;
    matrix = M4x4.rotate(Math.PI / 6, [1, 0, 0], matrix, []) as Matrix4x4;
    const position: Vector3 = [12345.6, 9876.4, 2345.2];
    matrix[12] = position[0];
    matrix[13] = position[1];
    matrix[14] = position[2];
    const rect = { width: 572, height: 466.5, top: 0, left: 0 };
    const items: Item[] = [];
    determineBucketsForPlaneByRows(
      "BEST_QUALITY_FIRST",
      [
        [1, 1, 1],
        [2, 2, 1],
        [4, 4, 2],
        [8, 8, 4],
      ],
      position,
      (bucketAddress, priority) => items.push({ bucketAddress, priority }),
      M4x4.scale1(1.3, matrix) as Matrix4x4,
      0,
      { PLANE_XY: rect, PLANE_XZ: rect, PLANE_YZ: rect, TDView: rect },
    );
    expect(items.length).toBeGreaterThan(1000);
    expect(items.every((item) => Number.isInteger(item.priority))).toBe(true);
    expectSameOrderOfPriorities(sortWithCountingSort(items), sortWithPriorityQueue(items));
  });
});

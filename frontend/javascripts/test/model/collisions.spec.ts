import { describe, it, expect } from "vitest";
import traverse from "viewer/model/bucket_data_handling/bucket_traversals";

describe("Traversal", () => {
  it("diagonal line", () => {
    const buckets = traverse([0, 0, 0], [33, 33, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]);
  });

  it("diagonal line with offset", () => {
    const buckets = traverse([31, 0, 0], [95, 64, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [2, 1, 0],
      [2, 2, 0],
    ]);
  });

  it("regression test for negative coordinates", () => {
    const buckets = traverse(
      [1143.3916015625, 1219.5518798828125, -36.1658935546875],
      [-266.7101135253906, 1219.5518798828125, 1054.467041015625],
      [
        [1, 1, 1],
        [2, 2, 2],
        [4, 4, 4],
      ],
      2,
    );
    const expectedBuckets = [
      [8, 9, -1],
      [8, 9, 0],
      [7, 9, 0],
      [7, 9, 1],
      [6, 9, 1],
      [5, 9, 1],
      [5, 9, 2],
      [4, 9, 2],
      [4, 9, 3],
      [3, 9, 3],
      [3, 9, 4],
      [2, 9, 4],
      [2, 9, 5],
      [1, 9, 5],
      [0, 9, 5],
      [0, 9, 6],
      [-1, 9, 6],
      [-1, 9, 7],
      [-2, 9, 7],
      [-2, 9, 8],
      [-3, 9, 8],
    ];
    expect(buckets.length).toBe(21);
    expect(buckets).toEqual(expectedBuckets);
  });

  it("slightly biased diagonal line", () => {
    const buckets = traverse([0, 0, 0], [34, 33, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ]);
  });

  it("horizontal line - short", () => {
    const buckets = traverse([0, 0, 0], [31, 0, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([[0, 0, 0]]);
  });

  it("horizontal line - touching", () => {
    const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });

  it("horizontal line - intersecting", () => {
    const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
    expect(buckets).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
  });
});

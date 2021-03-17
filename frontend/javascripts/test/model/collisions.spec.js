// @flow
import test from "ava";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";

test("Traversal: diagonal line", t => {
  const buckets = traverse([0, 0, 0], [33, 33, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]);
});

test("Traversal: diagonal line with offset", t => {
  const buckets = traverse([31, 0, 0], [95, 64, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]]);
});

test("Traversal: regression test for negative coordinates", t => {
  const buckets = traverse(
    [1143.3916015625, 1219.5518798828125, -36.1658935546875],
    [-266.7101135253906, 1219.5518798828125, 1054.467041015625],
    [[1, 1, 1], [2, 2, 2], [4, 4, 4]],
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

  t.is(buckets.length, 21);
  t.deepEqual(buckets, expectedBuckets);
});

test("Traversal: slightly biased diagonal line", t => {
  const buckets = traverse([0, 0, 0], [34, 33, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
});

test("Traversal: horizontal line - short", t => {
  const buckets = traverse([0, 0, 0], [31, 0, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0]]);
});

test("Traversal: horizontal line - touching", t => {
  const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0]]);
});

test("Traversal: horizontal line - intersecting", t => {
  const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0]]);
});

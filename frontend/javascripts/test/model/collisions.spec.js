// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import traverse from "oxalis/model/bucket_data_handling/bucket_traversals";

test("Traversal: diagonal line", t => {
  const buckets = traverse([0, 0, 0], [33, 33, 0], [[1, 1, 1]], 0);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]);
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

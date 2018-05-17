// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import { V2 } from "libs/mjs";
import { traverse } from "oxalis/model/binary/bucket_traversals";

type Vector3 = [number, number, number];
type Shape = {
  normals: Vector3[],
  corners: Vector3[],
};

const cube = {
  normals: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  corners: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
};

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

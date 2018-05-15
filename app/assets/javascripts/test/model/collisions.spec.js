// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import test from "ava";
import { V2 } from "libs/mjs";
import { intersects } from "libs/collision_test";
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

// test("Collision", t => {
//   const normalize = vec => ((vec.map(el => el / 2 ** 0.5): any): Vector3);

//   const shape2 = {
//     normals: [normalize([1, 1, 0])],
//     corners: [[-0.5, -0.5, -0.5], [1.5, 1.5, -0.5], [0.5, 0.5, 1.5], [1.5, 1.5, 1.5]],
//   };

//   t.true(intersects(cube, shape2));

//   const shape3 = {
//     normals: [normalize([1, 1, 0])],
//     corners: [[+2, +2, -0.5], [1.5, 1.5, -0.5], [2, 2, 1.5], [1.5, 1.5, 1.5]],
//   };

//   t.false(intersects(cube, shape3));
// });

test("Traversal: diagonal line", t => {
  const buckets = traverse([0, 0, 0], [33, 33, 0], [[1, 1, 1]], 0);
  console.log(buckets);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]);
});

test("Traversal: slightly biased diagonal line", t => {
  const buckets = traverse([0, 0, 0], [34, 33, 0], [[1, 1, 1]], 0);
  console.log(buckets);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0], [1, 1, 0]]);
});

test("Traversal: horizontal line - short", t => {
  const buckets = traverse([0, 0, 0], [31, 0, 0], [[1, 1, 1]], 0);
  console.log(buckets);
  t.deepEqual(buckets, [[0, 0, 0]]);
});

test("Traversal: horizontal line - touching", t => {
  const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
  console.log(buckets);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0]]);
});

test("Traversal: horizontal line - intersecting", t => {
  const buckets = traverse([0, 0, 0], [32, 0, 0], [[1, 1, 1]], 0);
  console.log(buckets);
  t.deepEqual(buckets, [[0, 0, 0], [1, 0, 0]]);
});

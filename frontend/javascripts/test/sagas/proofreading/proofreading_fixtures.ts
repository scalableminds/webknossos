import type { Vector2 } from "viewer/constants";

export const initialMapping = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
]);

export const edgesForInitialMapping: Vector2[] = [
  [1, 2],
  [2, 3],
  [4, 5],
  [6, 7],
  [1337, 1338],
];

export const expectedMappingAfterMerge = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 6],
  [7, 6],
  // [1337, 1337],
]);

export const expectedMappingAfterMergeRebase = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 1],
  [7, 1],
  // [1337, 1337],
]);

export const expectedMappingAfterSplit = new Map([
  [1, 1],
  [2, 1339],
  [3, 1339],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
  // [1337, 1338], -- not loaded by FE during test scenario, but exists in backend mock
]);

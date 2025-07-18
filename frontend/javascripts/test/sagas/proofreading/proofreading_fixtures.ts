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
  [2, 8],
  [3, 8],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
  // [1337, 1337],
]);

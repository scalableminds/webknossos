// The local mapping is Number-keyed/valued here, since the shared test segmentation layer's
// element class is uint16 (non-64-bit).
export const initialMapping = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
]);

// This seeds the backend mock's agglomerate graph (AgglomerateMapping), which always operates in
// bigint (matching the real wire/persistence format for agglomerate graph edges) regardless of the
// segmentation layer's element class -- unlike the local mapping above, this stays bigint.
export const edgesForInitialMapping: Array<[bigint, bigint]> = [
  [1n, 2n], // read as: 1 swallows 2
  [2n, 3n],
  [4n, 5n],
  [6n, 7n],
  [1337n, 1338n],
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

export const expectedMappingAfterMerge2 = new Map([
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 4],
  [5, 4],
  [6, 4],
  [7, 4],
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

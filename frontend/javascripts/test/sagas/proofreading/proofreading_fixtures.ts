export const initialMapping = new Map([
  [1n, 1n],
  [2n, 1n],
  [3n, 1n],
  [4n, 4n],
  [5n, 4n],
  [6n, 6n],
  [7n, 6n],
]);

export const edgesForInitialMapping: Array<[bigint, bigint]> = [
  [1n, 2n], // read as: 1 swallows 2
  [2n, 3n],
  [4n, 5n],
  [6n, 7n],
  [1337n, 1338n],
];

export const expectedMappingAfterMerge = new Map([
  [1n, 1n],
  [2n, 1n],
  [3n, 1n],
  [4n, 1n],
  [5n, 1n],
  [6n, 6n],
  [7n, 6n],
  // [1337n, 1337n],
]);

export const expectedMappingAfterMerge2 = new Map([
  [1n, 1n],
  [2n, 1n],
  [3n, 1n],
  [4n, 4n],
  [5n, 4n],
  [6n, 4n],
  [7n, 4n],
  // [1337n, 1337n],
]);

export const expectedMappingAfterMergeRebase = new Map([
  [1n, 1n],
  [2n, 1n],
  [3n, 1n],
  [4n, 1n],
  [5n, 1n],
  [6n, 1n],
  [7n, 1n],
  // [1337n, 1337n],
]);

export const expectedMappingAfterSplit = new Map([
  [1n, 1n],
  [2n, 1339n],
  [3n, 1339n],
  [4n, 4n],
  [5n, 4n],
  [6n, 6n],
  [7n, 6n],
  // [1337n, 1338n], -- not loaded by FE during test scenario, but exists in backend mock
]);

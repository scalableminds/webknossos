import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import _ from "lodash";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";

type Vector5 = [number, number, number, number, number];
type Key = Vector5; // [x, y, z, layerIdx, requestedMagIdx]
type Value = number; // [address, actualMagIdx]
type Entry = [Key, Value];

const { CuckooTableVec5 } = mock.reRequire("libs/cuckoo/cuckoo_table_vec5");

function generateRandomEntry(): Entry {
  return [
    [
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 2 ** 5),
      Math.floor(Math.random() * 2 ** 6),
    ],
    Math.floor(Math.random() * 2 ** 21),
  ];
}

function generateRandomEntrySet() {
  const count = 1600;
  const set = new Set();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const entry = generateRandomEntry();
    const entryKey = entry[0];
    if (set.has(entryKey)) {
      i--;
      continue;
    }
    set.add(entryKey);
    entries.push(entry);
  }
  return entries;
}

function isValueEqual(t: ExecutionContext<any>, val1: Value, val2: Value) {
  if (!(val1 === val2)) {
    // Throw an error to avoid that ava executes the rest of the test.
    throw new Error(`${val1} !== ${val2}`);
  }

  t.true(val1 === val2);
}

test.serial("CuckooTableVec5: Compression/Decompression roundtrip", (t) => {
  const ct = CuckooTableVec5.fromCapacity(0);
  const expectedEntry = [[363, 213, 995, 28, 58], 1547497];

  const actualEntry = ct.decompressEntry(ct.compressEntry(...expectedEntry));

  t.deepEqual(expectedEntry, actualEntry);
});

test.serial("CuckooTableVec5: Basic", (t) => {
  const entries = generateRandomEntrySet();
  const ct = CuckooTableVec5.fromCapacity(entries.length);

  for (const entry of entries) {
    ct.set(entry[0], entry[1]);
    const readValue = ct.get(entry[0]);

    isValueEqual(t, entry[1], readValue);
  }

  // Check that all previously set items are still
  // intact.
  for (const innerEntry of entries) {
    isValueEqual(t, innerEntry[1], ct.get(innerEntry[0]));
  }
});

test.serial("CuckooTableVec5: Speed should be alright", (t) => {
  const RUNS = 100;
  const hashSets = _.range(RUNS).map(() => generateRandomEntrySet());
  const tables = _.range(RUNS).map(() => CuckooTableVec5.fromCapacity(hashSets[0].length));

  const durations = [];
  for (let idx = 0; idx < RUNS; idx++) {
    const ct = tables[idx];
    const entries = hashSets[idx];
    for (const entry of entries) {
      const then = performance.now();
      ct.set(entry[0], entry[1]);
      const now = performance.now();
      durations.push(now - then);
    }
  }

  t.true(_.mean(durations) < 0.1);
});

test.serial("CuckooTableVec5: Repeated sets should work", (t) => {
  const ct = CuckooTableVec5.fromCapacity(1);

  // This is a regression test for a bug which resulted in the
  // same key being multiple times in the table. Due to the random
  // usage of seeds, the bug did not always occur. Therefore,
  // the following loop iterates 1000 times to be extra thorough.
  for (let n = 0; n < 1000; n++) {
    for (let _idx = 0; _idx < ct.entryCapacity; _idx++) {
      const entry: Entry = [[1, 2, 3, 4, 5], n];
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);
      isValueEqual(t, entry[1], readValue);
    }
  }
});

test.serial("CuckooTableVec5: Should throw error when exceeding capacity", (t) => {
  const ct = CuckooTableVec5.fromCapacity(1);

  t.throws(() => {
    for (let _idx = 0; _idx < ct.entryCapacity + 1; _idx++) {
      const entry: Entry = [[_idx, 2, 3, 4, 5], 6];
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);
      isValueEqual(t, entry[1], readValue);
    }
  });
});

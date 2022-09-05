import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import _ from "lodash";
import { Vector3 } from "oxalis/constants";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";

type Entry = [number, Vector3];

const { CuckooTable } = mock.reRequire("oxalis/model/bucket_data_handling/cuckoo_table");

function generateRandomEntry(): [number, Vector3] {
  return [
    Math.floor(Math.random() * 2 ** 32),
    [
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
      Math.floor(Math.random() * 1000),
    ],
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

function isValueEqual(t: ExecutionContext<any>, val1: Vector3, val2: Vector3) {
  if (!(val1[0] === val2[0] && val1[1] === val2[1] && val1[2] === val2[2])) {
    throw new Error(`${val1} !== ${val2}`);
  }

  t.true(val1[0] === val2[0]);
  t.true(val1[1] === val2[1]);
  t.true(val1[2] === val2[2]);
}

test.serial("CuckooTable: Basic", (t) => {
  const entries = generateRandomEntrySet();
  const ct = CuckooTable.fromCapacity(entries.length);
  let n = 0;
  for (const entry of entries) {
    ct.set(entry[0], entry[1]);
    const readValue = ct.get(entry[0]);

    isValueEqual(t, entry[1], readValue);
    n++;
  }

  // Check that all previously set items are still
  // intact.
  n = 0;
  for (const innerEntry of entries) {
    isValueEqual(t, innerEntry[1], ct.get(innerEntry[0]));
    n++;
  }
});

test.serial("CuckooTable: Speed should be alright", (t) => {
  const RUNS = 100;
  const hashSets = _.range(RUNS).map(() => generateRandomEntrySet());
  const tables = _.range(RUNS).map(() => CuckooTable.fromCapacity(hashSets[0].length));

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

test.serial("CuckooTable: Repeated sets should work", (t) => {
  const ct = CuckooTable.fromCapacity(1);

  for (let _idx = 0; _idx < ct.entryCapacity; _idx++) {
    const entry: Entry = [1, [2, 3, 4]];
    ct.set(entry[0], entry[1]);
    const readValue = ct.get(entry[0]);
    isValueEqual(t, entry[1], readValue);
  }
});

test.serial("CuckooTable: Should throw error when exceeding capacity", (t) => {
  const ct = CuckooTable.fromCapacity(1);

  t.throws(() => {
    for (let _idx = 0; _idx < ct.entryCapacity + 1; _idx++) {
      const entry: Entry = [_idx + 1, [2, 3, 4]];
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);
      isValueEqual(t, entry[1], readValue);
    }
  });
});

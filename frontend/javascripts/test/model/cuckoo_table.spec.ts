import test, { type ExecutionContext } from "ava";
import _ from "lodash";
import mock from "mock-require";
import type { Vector3 } from "oxalis/constants";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Entry = [number, Vector3];

const { CuckooTableVec3 } = mock.reRequire("libs/cuckoo/cuckoo_table_vec3");

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

function isValueEqual(t: ExecutionContext<any>, val1: Vector3, val2: Vector3) {
  if (!(val1[0] === val2[0] && val1[1] === val2[1] && val1[2] === val2[2])) {
    // Throw an error to avoid that ava executes the rest of the test.
    throw new Error(`${val1} !== ${val2}`);
  }

  t.true(val1[0] === val2[0]);
  t.true(val1[1] === val2[1]);
  t.true(val1[2] === val2[2]);
}

test("CuckooTableVec3: Basic", (t) => {
  const entries = generateRandomCuckooEntrySet(generateRandomEntry);
  const ct = CuckooTableVec3.fromCapacity(entries.length);

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

test("CuckooTableVec3: Speed should be alright", (t) => {
  const RUNS = 100;
  const hashSets = _.range(RUNS).map(() => generateRandomCuckooEntrySet(generateRandomEntry));
  const tables = _.range(RUNS).map(() => CuckooTableVec3.fromCapacity(hashSets[0].length));

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

test("CuckooTableVec3: Repeated sets should work", (t) => {
  const ct = CuckooTableVec3.fromCapacity(1);

  // This is a regression test for a bug which resulted in the
  // same key being multiple times in the table. Due to the random
  // usage of seeds, the bug did not always occur. Therefore,
  // the following loop iterates 1000th times to be extra thorough.
  for (let n = 0; n < 1000; n++) {
    for (let _idx = 0; _idx < ct.entryCapacity; _idx++) {
      const entry: Entry = [1, [2, 3, n]];
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);
      isValueEqual(t, entry[1], readValue);
    }
  }
});

test("CuckooTableVec3: Should throw error when exceeding capacity", (t) => {
  const ct = CuckooTableVec3.fromCapacity(1);

  t.throws(() => {
    for (let _idx = 0; _idx < ct.entryCapacity + 1; _idx++) {
      const entry: Entry = [_idx + 1, [2, 3, 4]];
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);
      isValueEqual(t, entry[1], readValue);
    }
  });
});

test("CuckooTableVec3: Maxing out capacity", (t) => {
  const base = 128;
  const attemptCount = 10;
  for (let attempt = 0; attempt < attemptCount; attempt++) {
    let entries;
    let ct;

    ct = new CuckooTableVec3(base);
    entries = generateRandomCuckooEntrySet(generateRandomEntry, ct.getCriticalCapacity());
    for (const entry of entries) {
      ct.set(entry[0], entry[1]);
    }

    // Check that all previously set items are still
    // intact.
    for (const innerEntry of entries) {
      isValueEqual(t, innerEntry[1], ct.get(innerEntry[0]));
    }
  }
});

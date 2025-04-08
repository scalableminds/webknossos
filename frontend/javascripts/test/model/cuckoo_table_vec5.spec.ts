import { describe, it, expect } from "vitest";
import _ from "lodash";

import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Vector5 = [number, number, number, number, number];
type Key = Vector5; // [x, y, z, layerIdx, requestedMagIdx]
type Value = number; // [address, actualMagIdx]
type Entry = [Key, Value];

import { CuckooTableVec5 } from "libs/cuckoo/cuckoo_table_vec5";

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

function isValueEqual(val1: Value, val2: Value | null) {
  // Ensure val2 is not null
  expect(val2).not.toBeNull();
  if (val2 === null) return;

  if (!(val1 === val2)) {
    // Throw an error to avoid continuing the test if values don't match
    throw new Error(`${val1} !== ${val2}`);
  }

  expect(val1).toBe(val2);
}

describe("CuckooTableVec5", () => {
  it("Compression/Decompression roundtrip", () => {
    const ct = CuckooTableVec5.fromCapacity(0);
    const expectedEntry: Entry = [[363, 213, 995, 28, 58], 1547497];

    const actualEntry = ct.decompressEntry(
      ct.compressEntry(expectedEntry[0] as Vector5, expectedEntry[1]),
    );

    expect(expectedEntry).toEqual(actualEntry);
  });

  it("Basic", () => {
    const entries = generateRandomCuckooEntrySet(generateRandomEntry);
    const ct = CuckooTableVec5.fromCapacity(entries.length);

    for (const entry of entries) {
      ct.set(entry[0], entry[1]);
      const readValue = ct.get(entry[0]);

      isValueEqual(entry[1], readValue);
    }

    // Check that all previously set items are still intact
    for (const innerEntry of entries) {
      isValueEqual(innerEntry[1], ct.get(innerEntry[0]));
    }
  });

  it("Speed should be alright", () => {
    const RUNS = 100;
    const hashSets = _.range(RUNS).map(() => generateRandomCuckooEntrySet(generateRandomEntry));
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

    expect(_.mean(durations)).toBeLessThan(0.1);
  });

  it("Repeated sets should work", () => {
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
        isValueEqual(entry[1], readValue);
      }
    }
  });

  it("Should throw error when exceeding capacity", () => {
    const ct = CuckooTableVec5.fromCapacity(1);

    expect(() => {
      for (let _idx = 0; _idx < ct.entryCapacity + 1; _idx++) {
        const entry: Entry = [[_idx, 2, 3, 4, 5], 6];
        ct.set(entry[0], entry[1]);
        const readValue = ct.get(entry[0]);
        isValueEqual(entry[1], readValue);
      }
    }).toThrow();
  });

  it("Maxing out capacity", { timeout: 20000 }, () => {
    const textureWidth = 128;
    const attemptCount = 10;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      let entries;
      let ct;
      ct = new CuckooTableVec5(textureWidth);
      entries = generateRandomCuckooEntrySet(generateRandomEntry, ct.getCriticalCapacity());
      for (const entry of entries) {
        ct.set(entry[0], entry[1]);
      }

      // Check that all previously set items are still intact
      for (const innerEntry of entries) {
        isValueEqual(innerEntry[1], ct.get(innerEntry[0]));
      }
    }
  });
});

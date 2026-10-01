import { describe, expect, it } from "vitest";

import "test/mocks/updatable_texture.mock";
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";
import { convertNumberTo64BitTuple } from "libs/utils";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Key = [number, number];
type Value = [number, number];
type Entry = [Key, Value];

function generateRandomEntry(): Entry {
  return [
    [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)],
    [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)],
  ];
}

function isValueEqual(val1: Value, val2: Value | null) {
  // Ensure val2 is not null
  expect(val2).not.toBeNull();
  if (val2 === null) return;

  if (!(val1[0] === val2[0] && val1[1] === val2[1])) {
    // Throw an error to avoid continuing the test if values don't match
    throw new Error(`${val1} !== ${val2}`);
  }

  expect(val1).toEqual(val2);
}

describe("CuckooTableUint64", () => {
  it("Maxing out capacity", { timeout: 25000 }, () => {
    const textureWidth = 128;
    const attemptCount = 10;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      let entries;
      let ct;

      ct = new CuckooTableUint64(textureWidth);
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

  // Mirrors the production scenario in which the keys are ordinary segment ids. These fit into
  // 32 bit, which means that the high word of every 64-bit key is 0. Only the low word carries
  // entropy, so the key is effectively hashed with a single _hashCombine call.
  function generateSmallIds(count: number): number[] {
    const ids = new Set<number>();
    while (ids.size < count) {
      // Segment ids are far below 2 ** 32 in practice.
      ids.add(1 + Math.floor(Math.random() * 100_000_000));
    }
    return Array.from(ids);
  }

  function fillWithSmallIds(ct: CuckooTableUint64, ids: number[]) {
    for (const id of ids) {
      ct.setNumberLike(id, id + 1);
    }
    for (const id of ids) {
      isValueEqual(convertNumberTo64BitTuple(id + 1), ct.get(convertNumberTo64BitTuple(id)));
    }
  }

  it("Sparsely filled table with segment ids that fit into 32 bit", () => {
    // Even at a very low load factor, the table must not run out of rehash attempts.
    const textureWidth = 512; // entryCapacity = 262_144
    const ct = new CuckooTableUint64(textureWidth);
    fillWithSmallIds(ct, generateSmallIds(Math.floor(ct.entryCapacity / 16)));
  });

  it("Maxing out capacity with segment ids that fit into 32 bit", { timeout: 25000 }, () => {
    const textureWidth = 128;
    const attemptCount = 10;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      const ct = new CuckooTableUint64(textureWidth);
      fillWithSmallIds(ct, generateSmallIds(ct.getCriticalCapacity()));
    }
  });
});

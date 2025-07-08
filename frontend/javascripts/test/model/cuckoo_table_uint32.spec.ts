import { describe, it, expect } from "vitest";

import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Key = number;
type Value = number;
type Entry = [Key, Value];

import { CuckooTableUint32 } from "libs/cuckoo/cuckoo_table_uint32";

function generateRandomEntry(): Entry {
  return [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)];
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

describe("CuckooTableUint32", () => {
  it("Maxing out capacity", { timeout: 25000 }, () => {
    const textureWidth = 128;

    const attemptCount = 10;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      let entries;
      let ct;

      ct = new CuckooTableUint32(textureWidth);
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

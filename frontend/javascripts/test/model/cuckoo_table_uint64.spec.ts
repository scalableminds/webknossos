import { describe, it, expect } from "vitest";

import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Key = [number, number];
type Value = [number, number];
type Entry = [Key, Value];

// // Mock the CuckooTableUint64 module before importing it
// vi.mock("libs/cuckoo/cuckoo_table_uint64", async () => {
//   // Import the actual module
//   const actual = await import("libs/cuckoo/cuckoo_table_uint64");
//   // Return it as is (we're just ensuring it's mocked so that it uses our mocked dependencies)
//   return actual;
// });
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";

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
  it("Maxing out capacity", () => {
    const base = 128;
    const attemptCount = 10;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      let entries;
      let ct;

      ct = new CuckooTableUint64(base);
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

import test, { type ExecutionContext } from "ava";
import mock from "mock-require";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Key = [number, number];
type Value = [number, number];
type Entry = [Key, Value];

const { CuckooTableUint64 } = mock.reRequire("libs/cuckoo/cuckoo_table_uint64");

function generateRandomEntry(): Entry {
  return [
    [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)],
    [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)],
  ];
}

function isValueEqual(t: ExecutionContext<any>, val1: Value, val2: Value) {
  if (!(val1[0] === val2[0] && val1[1] === val2[1])) {
    // Throw an error to avoid that ava executes the rest of the test.
    throw new Error(`${val1} !== ${val2}`);
  }

  t.deepEqual(val1, val2);
}

test("CuckooTableUint64: Maxing out capacity", (t) => {
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

    // Check that all previously set items are still
    // intact.
    for (const innerEntry of entries) {
      isValueEqual(t, innerEntry[1], ct.get(innerEntry[0]));
    }
  }
});

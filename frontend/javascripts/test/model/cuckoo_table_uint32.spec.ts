import mock from "mock-require";
import test, { type ExecutionContext } from "ava";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";
import { generateRandomCuckooEntrySet } from "./cuckoo_table_helpers";

type Key = number;
type Value = number;
type Entry = [Key, Value];

const { CuckooTableUint32 } = mock.reRequire("libs/cuckoo/cuckoo_table_uint32");

function generateRandomEntry(): Entry {
  return [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)];
}

function isValueEqual(t: ExecutionContext<any>, val1: Value, val2: Value) {
  if (!(val1 === val2)) {
    // Throw an error to avoid that ava executes the rest of the test.
    throw new Error(`${val1} !== ${val2}`);
  }

  t.true(val1 === val2);
}

test("CuckooTableUint32: Maxing out capacity", (t) => {
  const base = 128;

  const attemptCount = 10;
  for (let attempt = 0; attempt < attemptCount; attempt++) {
    let entries;
    let ct;

    ct = new CuckooTableUint32(base);
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

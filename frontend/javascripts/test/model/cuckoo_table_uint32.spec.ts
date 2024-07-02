import mock from "mock-require";
import test, { ExecutionContext } from "ava";
import _ from "lodash";

import "test/mocks/globals.mock";
import "test/mocks/updatable_texture.mock";

type Key = number;
type Value = number;
type Entry = [Key, Value];

const { CuckooTableUint32 } = mock.reRequire("libs/cuckoo/cuckoo_table_uint32");

function generateRandomEntry(): Entry {
  return [Math.floor(Math.random() * 2 ** 32), Math.floor(Math.random() * 2 ** 32)];
}

function generateRandomEntrySet(count: number = 1600) {
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

test.serial("CuckooTableUint32: Maxing out capacity", (t) => {
  const entries = generateRandomEntrySet(2 ** 16);
  const ct = CuckooTableUint32.fromCapacity(Math.floor(entries.length));

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

import { Vector3 } from "oxalis/constants";
import { AbstractCuckooTable, EMPTY_KEY_VALUE } from "./abstract_cuckoo_table";

const EMPTY_KEY = EMPTY_KEY_VALUE;
const EMPTY_VALUE = [EMPTY_KEY, EMPTY_KEY, EMPTY_KEY] as Value;

type Key = number;
type Value = Vector3;
type Entry = [Key, Value];

export class CuckooTable extends AbstractCuckooTable<Key, Value, Entry> {
  static fromCapacity(requestedCapacity: number): CuckooTable {
    return new CuckooTable(this.computeTextureWidthFromCapacity(requestedCapacity));
  }

  getEmptyKey(): Key {
    return EMPTY_KEY;
  }

  getEmptyValue(): Value {
    return EMPTY_VALUE;
  }

  getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry {
    const table = optTable || this.table;
    const offset = hashedAddress * AbstractCuckooTable.ELEMENTS_PER_ENTRY;
    return [table[offset], [table[offset + 1], table[offset + 2], table[offset + 3]]];
  }

  canDisplacedEntryBeIgnored(displacedKey: Key, newKey: Key): boolean {
    return (
      // Either, the slot is empty... (the value of EMPTY_KEY is not allowed as a key)
      displacedKey === EMPTY_KEY ||
      // or the slot already refers to the key
      displacedKey === newKey
    );
  }

  checkValidKey(key: Key) {
    if (key === EMPTY_KEY) {
      throw new Error(`The key ${EMPTY_KEY} is not allowed for the CuckooTable.`);
    }
  }

  _areKeysEqual(key1: Key, key2: Key): boolean {
    return key1 === key2;
  }

  writeEntryToTable(key: Key, value: Value, hashedAddress: number) {
    const offset = hashedAddress * AbstractCuckooTable.ELEMENTS_PER_ENTRY;
    this.table[offset] = key;
    this.table[offset + 1] = value[0];
    this.table[offset + 2] = value[1];
    this.table[offset + 3] = value[2];
  }

  _hashKeyToAddress(seed: number, key: number): number {
    const state = this._hashCombine(seed, key);

    return state % this.entryCapacity;
  }
}

import { AbstractCuckooTable, EMPTY_KEY_VALUE } from "./abstract_cuckoo_table";

const EMPTY_KEY = [EMPTY_KEY_VALUE, EMPTY_KEY_VALUE] as Value;
const EMPTY_VALUE = [EMPTY_KEY_VALUE, EMPTY_KEY_VALUE] as Value;

// This module defines a cuckoo table that can map from a 64-bit key to 64-bit value.
// Both key and value are stored as a tuple of: [High-32-Bits, Low-32-Bits]
type Key = [number, number];
type Value = [number, number];
type Entry = [Key, Value];

export class CuckooTableUint64 extends AbstractCuckooTable<Key, Value, Entry> {
  static fromCapacity(requestedCapacity: number): CuckooTableUint64 {
    return new CuckooTableUint64(this.computeTextureWidthFromCapacity(requestedCapacity));
  }

  getEmptyKey(): Key {
    return EMPTY_KEY;
  }

  getEmptyValue(): Value {
    return EMPTY_VALUE;
  }

  // todop (easy): remove again
  // initializeTableArray() {
  //   this.table = new Uint32Array(this.getClass().getElementsPerEntry() * this.entryCapacity).fill(
  //     EMPTY_KEY_VALUE,
  //   );

  //   // The chance of colliding seeds is super low which is why
  //   // we ignore this case (a rehash would happen automatically, anyway).
  //   // Note that it makes sense to use all 32 bits for the seeds. Otherwise,
  //   // hash collisions are more likely to happen.
  //   this.seeds = [11, 11, 11];
  //   this.notifySeedListeners();
  // }

  getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry {
    const table = optTable || this.table;
    const offset = hashedAddress * this.getClass().getElementsPerEntry();
    return [
      [table[offset], table[offset + 1]],
      [table[offset + 2], table[offset + 3]],
    ];
  }

  canDisplacedEntryBeIgnored(displacedKey: Key, newKey: Key): boolean {
    return (
      // Either, the slot is empty... (the value of EMPTY_KEY is not allowed as a key)
      this._areKeysEqual(displacedKey, EMPTY_KEY) ||
      // or the slot already refers to the key
      this._areKeysEqual(displacedKey, newKey)
    );
  }

  checkValidKey(key: Key) {
    if (this._areKeysEqual(key, EMPTY_KEY)) {
      throw new Error(`The key ${EMPTY_KEY} is not allowed for the CuckooTable.`);
    }
  }

  _areKeysEqual(key1: Key, key2: Key): boolean {
    return key1[0] === key2[0] && key1[1] === key2[1];
  }

  writeEntryToTable(key: Key, value: Value, hashedAddress: number) {
    const offset = hashedAddress * this.getClass().getElementsPerEntry();
    this.table[offset] = key[0];
    this.table[offset + 1] = key[1];
    this.table[offset + 2] = value[0];
    this.table[offset + 3] = value[1];
  }

  _hashKeyToAddress(seed: number, key: Key): number {
    let state = this._hashCombine(seed, key[0]);
    state = this._hashCombine(state, key[1]);

    return state % this.entryCapacity;
  }
}

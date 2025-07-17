import { RGIntegerFormat, type PixelFormatGPU } from "three";
import type { NumberLike } from "viewer/store";
import { AbstractCuckooTable, EMPTY_KEY_VALUE } from "./abstract_cuckoo_table";

const EMPTY_KEY = EMPTY_KEY_VALUE;
const EMPTY_VALUE = EMPTY_KEY_VALUE;

// This module defines a cuckoo table that can map from a 32-bit key to 32-bit value.
type Key = number;
type Value = number;
type Entry = [Key, Value];

export class CuckooTableUint32 extends AbstractCuckooTable<Key, Value, Entry> {
  static getElementsPerEntry() {
    return 2;
  }
  static getTextureChannelCount() {
    return 2;
  }
  static getTextureFormat() {
    return RGIntegerFormat;
  }
  static getInternalFormat(): PixelFormatGPU {
    return "RG32UI";
  }
  static fromCapacity(requestedCapacity: number): CuckooTableUint32 {
    return new CuckooTableUint32(this.computeTextureWidthFromCapacity(requestedCapacity));
  }

  getEmptyKey(): Key {
    return EMPTY_KEY;
  }

  getEmptyValue(): Value {
    return EMPTY_VALUE;
  }

  getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry {
    const table = optTable || this.table;
    const offset = hashedAddress * this.getClass().getElementsPerEntry();
    return [table[offset], table[offset + 1]];
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
    return key1 === key2;
  }

  writeEntryToTable(key: Key, value: Value, hashedAddress: number) {
    const offset = hashedAddress * this.getClass().getElementsPerEntry();
    this.table[offset] = key;
    this.table[offset + 1] = value;
  }

  _hashKeyToAddress(seed: number, key: Key): number {
    let state = this._hashCombine(seed, key);
    return state % this.getDiminishedEntryCapacity();
  }

  setNumberLike(key: NumberLike, value: NumberLike) {
    if (typeof key !== "number" || typeof value !== "number") {
      throw new Error("Key and Value must be Number.");
    }
    this.set(key, value);
  }

  unsetNumberLike(key: NumberLike) {
    if (typeof key !== "number") {
      throw new Error("Key must be Number.");
    }
    this.unset(key);
  }
}

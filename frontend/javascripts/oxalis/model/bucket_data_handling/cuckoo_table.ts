import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { Vector3 } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { AbstractCuckooTable } from "./abstract_cuckoo_table";

const ELEMENTS_PER_ENTRY = 4;
const TEXTURE_CHANNEL_COUNT = 4;
const DEFAULT_LOAD_FACTOR = 0.25;
const EMPTY_KEY = 2 ** 32 - 1;
type Key = number;
type Value = Vector3;
type Entry = [Key, Value];

export class CuckooTable extends AbstractCuckooTable<Key, Value, Entry> {
  static fromCapacity(requestedCapacity: number): CuckooTable {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return new CuckooTable(textureWidth);
  }

  getEmptyKey(): Key {
    return EMPTY_KEY;
  }
  getEmptyValue(): Value {
    return [EMPTY_KEY, EMPTY_KEY, EMPTY_KEY];
  }

  getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry {
    const table = optTable || this.table;
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
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

  _areKeysEqual(key1: Key, key2: Key): boolean {
    return key1 === key2;
  }

  writeEntryToTable(key: Key, value: Value, hashedAddress: number) {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
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

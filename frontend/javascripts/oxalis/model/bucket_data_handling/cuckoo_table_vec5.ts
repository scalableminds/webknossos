import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { Vector2, Vector3, Vector4 } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { AbstractCuckooTable } from "./abstract_cuckoo_table";

type Vector5 = [number, number, number, number, number];
type Key = Vector5; // [x, y, z, requestedMagIdx, layerIdx]
type Value = number; // bucket address in texture
type Entry = [Key, Value];
// CompressedEntry = [
//    x, // 32 bit
//    y, // 32 bit
//    z, // 32 bit
//    // 32 bit = 5 (magIdx) + 6 (layerIdx) + 21 bit (bucket address)
//    requesteMagIdxAndLayerIdxAndBucketAddress
// ]
type CompressedEntry = Vector4;

// Actually, it's only 6 but we squeeze these into 4.
const ELEMENTS_PER_ENTRY = 4;
const TEXTURE_CHANNEL_COUNT = 4;
const DEFAULT_LOAD_FACTOR = 0.25;
const EMPTY_KEY_VALUE = 2 ** 32 - 1;
const EMPTY_KEY = [
  EMPTY_KEY_VALUE,
  EMPTY_KEY_VALUE,
  EMPTY_KEY_VALUE,
  EMPTY_KEY_VALUE,
  EMPTY_KEY_VALUE,
] as Key;

export class CuckooTableVec5 extends AbstractCuckooTable<Key, Value, Entry> {
  static fromCapacity(requestedCapacity: number): CuckooTableVec5 {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return new CuckooTableVec5(textureWidth);
  }

  checkValidKey(key: Key) {
    if (key[0] === EMPTY_KEY_VALUE) {
      throw new Error(`The key must not contain ${EMPTY_KEY_VALUE} at the first position.`);
    }
  }

  getEmptyKey(): Key {
    return EMPTY_KEY;
  }
  getEmptyValue(): Value {
    return EMPTY_KEY_VALUE;
  }

  getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    return this.readDecompressedEntry(offset, optTable);
  }

  _areKeysEqual(key1: Key, key2: Key): boolean {
    for (let i = 0; i < key1.length; i++) {
      if (key1[i] !== key2[i]) {
        return false;
      }
    }
    return true;
  }

  canDisplacedEntryBeIgnored(displacedKey: Key, newKey: Key): boolean {
    return (
      // Either, the slot is empty... (the value of EMPTY_KEY is not allowed as a key)
      displacedKey[0] === EMPTY_KEY_VALUE ||
      // or the slot already refers to the key
      this._areKeysEqual(displacedKey, newKey)
    );
  }

  readDecompressedEntry(offset: number, optTable?: Uint32Array) {
    const table = optTable || this.table;
    return this.decompressEntry(
      table.slice(offset, offset + ELEMENTS_PER_ENTRY) as unknown as Vector4,
    );
  }

  compressEntry(key: Key, value: Value): CompressedEntry {
    const compressedBytes =
      ((key[3] & (2 ** 5 - 1)) << (32 - 5)) +
      ((key[4] & (2 ** 6 - 1)) << (32 - 5 - 6)) +
      (value & (2 ** 21 - 1));

    return [key[0], key[1], key[2], compressedBytes];
  }

  decompressEntry(compressedEntry: CompressedEntry): Entry {
    const compressedBytes = compressedEntry[3];
    const magIndex = compressedBytes >>> (32 - 5);
    const layerIndex = (compressedBytes >>> (32 - 5 - 6)) & (2 ** 6 - 1);
    const address = compressedBytes & (2 ** 21 - 1);

    return [
      [compressedEntry[0], compressedEntry[1], compressedEntry[2], magIndex, layerIndex],
      address,
    ];
  }

  writeEntryToTable(key: Key, value: Value, hashedAddress: number) {
    const compressedEntry = this.compressEntry(key, value);
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    for (let i = 0; i < compressedEntry.length; i++) {
      this.table[offset + i] = compressedEntry[i];
    }
  }

  _hashKeyToAddress(seed: number, key: Key): number {
    let state = seed;
    state = this._hashCombine(state, key[0]); // x
    state = this._hashCombine(state, key[1]); // y
    state = this._hashCombine(state, key[2]); // z
    state = this._hashCombine(state, key[3]); // magIdx
    state = this._hashCombine(state, key[4]); // layerIdx

    return state % this.entryCapacity;
  }
}

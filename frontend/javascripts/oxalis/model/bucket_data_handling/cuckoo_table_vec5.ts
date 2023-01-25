import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { Vector2, Vector3, Vector4 } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";

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

export type SeedSubscriberFn = (seeds: number[]) => void;

let cachedNullTexture: UpdatableTexture | undefined;

export class CuckooTableVec5 {
  entryCapacity: number;
  table!: Uint32Array;
  seeds!: number[];
  seedSubscribers: Array<SeedSubscriberFn> = [];
  _texture: UpdatableTexture;
  textureWidth: number;

  constructor(textureWidth: number) {
    this.textureWidth = textureWidth;
    this._texture = createUpdatableTexture(
      textureWidth,
      textureWidth,
      TEXTURE_CHANNEL_COUNT,
      THREE.UnsignedIntType,
      getRenderer(),
      THREE.RGBAIntegerFormat,
    );

    // The internal format has to be set manually, since ThreeJS does not
    // derive this value by itself.
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // for a reference of the internal formats.
    this._texture.internalFormat = "RGBA32UI";

    this.entryCapacity = Math.floor(
      (textureWidth ** 2 * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY,
    );

    this.initializeTableArray();
    // Initialize the texture once to avoid undefined behavior
    this.flushTableToTexture();
  }

  static fromCapacity(requestedCapacity: number): CuckooTableVec5 {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return new CuckooTableVec5(textureWidth);
  }

  static getNullTexture(): UpdatableTexture {
    if (cachedNullTexture) {
      return cachedNullTexture;
    }
    cachedNullTexture = createUpdatableTexture(
      0,
      0,
      TEXTURE_CHANNEL_COUNT,
      THREE.UnsignedIntType,
      getRenderer(),
      THREE.RGBAIntegerFormat,
    );
    cachedNullTexture.internalFormat = "RGBA32UI";

    return cachedNullTexture;
  }

  private initializeTableArray() {
    this.table = new Uint32Array(ELEMENTS_PER_ENTRY * this.entryCapacity).fill(EMPTY_KEY_VALUE);

    // The chance of colliding seeds is super low which is why
    // we ignore this case (a rehash would happen automatically, anyway).
    // Note that it makes sense to use all 32 bits for the seeds. Otherwise,
    // hash collisions are more likely to happen.
    this.seeds = [
      Math.floor(2 ** 32 * Math.random()),
      Math.floor(2 ** 32 * Math.random()),
      Math.floor(2 ** 32 * Math.random()),
    ];
    this.notifySeedListeners();
  }

  getTexture(): UpdatableTexture {
    return this._texture;
  }

  subscribeToSeeds(fn: SeedSubscriberFn): () => void {
    this.seedSubscribers.push(fn);
    this.notifySeedListeners();

    return () => {
      this.seedSubscribers = this.seedSubscribers.filter((el) => el !== fn);
    };
  }

  notifySeedListeners() {
    this.seedSubscribers.forEach((fn) => fn(this.seeds));
  }

  getUniformValues() {
    return {
      CUCKOO_ENTRY_CAPACITY: this.entryCapacity,
      CUCKOO_ELEMENTS_PER_ENTRY: ELEMENTS_PER_ENTRY,
      CUCKOO_ELEMENTS_PER_TEXEL: TEXTURE_CHANNEL_COUNT,
      CUCKOO_TWIDTH: this.textureWidth,
    };
  }

  flushTableToTexture() {
    this._texture.update(this.table, 0, 0, this.textureWidth, this.textureWidth);
  }

  set(pendingKey: Key, pendingValue: Value, rehashAttempt: number = 0) {
    if (pendingKey[0] === EMPTY_KEY_VALUE) {
      throw new Error(`The key must not contain ${EMPTY_KEY_VALUE} at the first position.`);
    }
    let displacedEntry;
    let currentAddress;
    let iterationCounter = 0;

    const ITERATION_THRESHOLD = 40;
    const REHASH_THRESHOLD = 100;

    if (rehashAttempt >= REHASH_THRESHOLD) {
      throw new Error(
        `Cannot rehash, since this is already the ${rehashAttempt}th attempt. Is the capacity exceeded?`,
      );
    }

    const existingValueWithAddress = this.getWithAddress(pendingKey);
    if (existingValueWithAddress) {
      // The key already exists. We only have to overwrite
      // the corresponding value.
      const [, address] = existingValueWithAddress;
      this.writeEntryAtAddress(pendingKey, pendingValue, address, rehashAttempt > 0);
      return;
    }

    let seedIndex = Math.floor(Math.random() * this.seeds.length);
    while (iterationCounter++ < ITERATION_THRESHOLD) {
      const seed = this.seeds[seedIndex];
      currentAddress = this._hashKeyToAddress(seed, pendingKey);

      // Swap pendingKey, pendingValue with what's contained in H1
      displacedEntry = this.writeEntryAtAddress(
        pendingKey,
        pendingValue,
        currentAddress,
        rehashAttempt > 0,
      );

      if (this.canDisplacedEntryBeIgnored(displacedEntry[0], pendingKey)) {
        return;
      }

      [pendingKey, pendingValue] = displacedEntry;

      // Pick another random seed for the next swap
      seedIndex =
        (seedIndex + Math.floor(Math.random() * (this.seeds.length - 1)) + 1) % this.seeds.length;
    }
    this.rehash(rehashAttempt + 1);
    this.set(pendingKey, pendingValue, rehashAttempt + 1);

    // Since a rehash was performed, the incremental texture updates were
    // skipped. Update the entire texture:
    this.flushTableToTexture();
  }

  unset(key: Key) {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        this.writeEntryAtAddress(EMPTY_KEY, EMPTY_KEY_VALUE, hashedAddress, false);
        return;
      }
    }
  }

  private rehash(rehashAttempt: number): void {
    const oldTable = this.table;

    this.initializeTableArray();

    for (
      let offset = 0;
      offset < this.entryCapacity * ELEMENTS_PER_ENTRY;
      offset += ELEMENTS_PER_ENTRY
    ) {
      if (oldTable[offset] === EMPTY_KEY_VALUE) {
        continue;
      }
      const [key, value] = this.getEntryAtAddress(offset / ELEMENTS_PER_ENTRY, oldTable);

      this.set(key, value, rehashAttempt);
    }
  }

  get(key: Key): Value | null {
    const result = this.getWithAddress(key);
    return result ? result[0] : null;
  }

  getWithAddress(key: Key): [Value, number] | null {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        return [value, hashedAddress];
      }
    }
    return null;
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

  private canDisplacedEntryBeIgnored(displacedKey: Key, newKey: Key): boolean {
    return (
      // Either, the slot is empty... (the value of EMPTY_KEY is not allowed as a key)
      displacedKey[0] === EMPTY_KEY_VALUE ||
      // or the slot already refers to the key
      this._areKeysEqual(displacedKey, newKey)
    );
  }

  doesAddressContainKey(key: Key, hashedAddress: number): boolean {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;

    const decompressedEntry = this.readDecompressedEntry(offset);
    const keyInTable = decompressedEntry[0];

    return this._areKeysEqual(keyInTable, key);
  }

  getValueAtAddress(key: Key, hashedAddress: number): Value | null {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    // todo: doesAddressContainKey also uses readDecompressedEntry (perf)
    if (this.doesAddressContainKey(key, hashedAddress)) {
      const decompressedEntry = this.readDecompressedEntry(offset);
      return decompressedEntry[1];
    } else {
      return null;
    }
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

  private writeEntryAtAddress(
    key: Key,
    value: Value,
    hashedAddress: number,
    isRehashing: boolean,
  ): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;

    const displacedEntry: Entry = this.readDecompressedEntry(offset);
    const compressedEntry = this.compressEntry(key, value);

    for (let i = 0; i < compressedEntry.length; i++) {
      this.table[offset + i] = compressedEntry[i];
    }

    if (!isRehashing) {
      const texelOffset = offset / TEXTURE_CHANNEL_COUNT;
      // Only partially update if we are not rehashing. Otherwise, it makes more
      // sense to flush the entire texture content after the rehashing is done.
      this._texture.update(
        this.table.subarray(offset, offset + ELEMENTS_PER_ENTRY),
        texelOffset % this.textureWidth,
        Math.floor(texelOffset / this.textureWidth),
        ELEMENTS_PER_ENTRY / TEXTURE_CHANNEL_COUNT,
        1,
      );
    }

    return displacedEntry;
  }

  _hashCombine(state: number, value: number) {
    // Based on Murmur3_32, since it is supported on the GPU.
    // See https://github.com/tildeleb/cuckoo for a project
    // written in golang which also supports Murmur hashes.
    const k1 = 0xcc9e2d51;
    const k2 = 0x1b873593;

    // eslint-disable-next-line no-param-reassign
    value >>>= 0;
    // eslint-disable-next-line no-param-reassign
    state >>>= 0;

    // eslint-disable-next-line no-param-reassign
    value = Math.imul(value, k1) >>> 0;
    // eslint-disable-next-line no-param-reassign
    value = ((value << 15) | (value >>> 17)) >>> 0;
    // eslint-disable-next-line no-param-reassign
    value = Math.imul(value, k2) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = (state ^ value) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = ((state << 13) | (state >>> 19)) >>> 0;
    // eslint-disable-next-line no-param-reassign
    state = (state * 5 + 0xe6546b64) >>> 0;
    return state;
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

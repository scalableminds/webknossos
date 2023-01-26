import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";

const ELEMENTS_PER_ENTRY = 4;
const TEXTURE_CHANNEL_COUNT = 4;
const DEFAULT_LOAD_FACTOR = 0.25;
const EMPTY_KEY = 2 ** 32 - 1;
const EMPTY_KEY_VALUE = 2 ** 32 - 1;

export type SeedSubscriberFn = (seeds: number[]) => void;

let cachedNullTexture: UpdatableTexture | undefined;

export abstract class AbstractCuckooTable<K, V, Entry extends [K, V]> {
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

  static computeTextureWidthFromCapacity(requestedCapacity: number): number {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return textureWidth;
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

  checkValidKey(key: K) {
    if (key === EMPTY_KEY) {
      throw new Error(`The key ${EMPTY_KEY} is not allowed for the CuckooTable.`);
    }
  }

  set(pendingKey: K, pendingValue: V, rehashAttempt: number = 0) {
    this.checkValidKey(pendingKey);
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

  unset(key: K) {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        this.writeEntryAtAddress(this.getEmptyKey(), this.getEmptyValue(), hashedAddress, false);
        return;
      }
    }
  }

  abstract getEmptyKey(): K;
  abstract getEmptyValue(): V;

  private rehash(rehashAttempt: number): void {
    const oldTable = this.table;

    this.initializeTableArray();

    for (
      let offset = 0;
      offset < this.entryCapacity * ELEMENTS_PER_ENTRY;
      offset += ELEMENTS_PER_ENTRY
    ) {
      if (oldTable[offset] === EMPTY_KEY) {
        continue;
      }
      const [key, value] = this.getEntryAtAddress(offset / ELEMENTS_PER_ENTRY, oldTable);
      this.set(key, value, rehashAttempt);
    }
  }

  get(key: K): V | null {
    const result = this.getWithAddress(key);
    return result ? result[0] : null;
  }

  getWithAddress(key: K): [V, number] | null {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        return [value, hashedAddress];
      }
    }
    return null;
  }

  abstract getEntryAtAddress(hashedAddress: number, optTable?: Uint32Array): Entry;

  abstract canDisplacedEntryBeIgnored(displacedKey: K, newKey: K): boolean;

  abstract _areKeysEqual(key1: K, key2: K): boolean;

  doesAddressContainKey(key: K, hashedAddress: number): boolean {
    const [foundKey] = this.getEntryAtAddress(hashedAddress);
    return this._areKeysEqual(foundKey, key);
  }

  getValueAtAddress(key: K, hashedAddress: number): V | null {
    // todo: doesAddressContainKey also uses getEntryAtAddress (perf)
    if (this.doesAddressContainKey(key, hashedAddress)) {
      const entry = this.getEntryAtAddress(hashedAddress);
      return entry[1];
    } else {
      return null;
    }
  }

  abstract writeEntryToTable(key: K, value: V, hashedAddress: number): void;

  writeEntryAtAddress(key: K, value: V, hashedAddress: number, isRehashing: boolean): Entry {
    const displacedEntry: Entry = this.getEntryAtAddress(hashedAddress);
    this.writeEntryToTable(key, value, hashedAddress);

    if (!isRehashing) {
      // Only partially update if we are not rehashing. Otherwise, it makes more
      // sense to flush the entire texture content after the rehashing is done.
      const offset = hashedAddress * ELEMENTS_PER_ENTRY;
      const texelOffset = offset / TEXTURE_CHANNEL_COUNT;
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

  abstract _hashKeyToAddress(seed: number, key: K): number;
}

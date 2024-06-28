import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import _ from "lodash";

const DEFAULT_LOAD_FACTOR = 0.55; // 0.65 is working
export const EMPTY_KEY_VALUE = 2 ** 32 - 1;

export type SeedSubscriberFn = (seeds: number[]) => void;

let cachedNullTexture: UpdatableTexture | undefined;

const throttledCapacityWarning = _.throttle((currentSize: number) => {
  if (currentSize) console.log("");
});

export abstract class AbstractCuckooTable<K, V, Entry extends [K, V]> {
  entryCapacity: number;
  table!: Uint32Array;
  seeds!: number[];
  seedSubscribers: Array<SeedSubscriberFn> = [];
  _texture: UpdatableTexture;
  textureWidth: number;

  static getTextureChannelCount() {
    return 4;
  }

  static getElementsPerEntry() {
    return 4;
  }

  static getTextureType() {
    return THREE.UnsignedIntType;
  }

  static getTextureFormat() {
    return THREE.RGBAIntegerFormat;
  }

  static getInternalFormat(): THREE.PixelFormatGPU {
    return "RGBA32UI";
  }

  getClass(): typeof AbstractCuckooTable {
    const thisConstructor = this.constructor as typeof AbstractCuckooTable;
    return thisConstructor;
  }

  constructor(textureWidth: number) {
    this.textureWidth = textureWidth;
    this._texture = createUpdatableTexture(
      textureWidth,
      textureWidth,
      this.getClass().getTextureChannelCount(),
      this.getClass().getTextureType(),
      getRenderer(),
      this.getClass().getTextureFormat(),
    );

    // The internal format has to be set manually, since ThreeJS does not
    // derive this value by itself.
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // for a reference of the internal formats.
    this._texture.internalFormat = this.getClass().getInternalFormat();

    this.entryCapacity = Math.floor(
      (textureWidth ** 2 * this.getClass().getTextureChannelCount()) /
        this.getClass().getElementsPerEntry(),
    );

    this.initializeTableArray();
    // Initialize the texture once to avoid undefined behavior
    this.flushTableToTexture();
  }

  getCriticalCapacity(): number {
    /*
     * Returns the capacity at which inserts can become very expensive due
     * to increased likelihood of collisions.
     */
    return Math.ceil(this.entryCapacity * DEFAULT_LOAD_FACTOR);
  }

  static computeTextureWidthFromCapacity(requestedCapacity: number): number {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * this.getTextureChannelCount()) / this.getElementsPerEntry()),
    );
    return textureWidth;
  }

  static getNullTexture(): UpdatableTexture {
    if (cachedNullTexture) {
      return cachedNullTexture;
    }
    cachedNullTexture = createUpdatableTexture(
      // Use 1x1 texture to avoid WebGL warnings.
      1,
      1,
      this.getTextureChannelCount(),
      this.getTextureType(),
      getRenderer(),
      this.getTextureFormat(),
    );
    cachedNullTexture.internalFormat = this.getInternalFormat();

    return cachedNullTexture;
  }

  private initializeTableArray() {
    this.table = new Uint32Array(this.getClass().getElementsPerEntry() * this.entryCapacity).fill(
      EMPTY_KEY_VALUE,
    );

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
      CUCKOO_ELEMENTS_PER_ENTRY: this.getClass().getElementsPerEntry(),
      CUCKOO_ELEMENTS_PER_TEXEL: this.getClass().getTextureChannelCount(),
      CUCKOO_TWIDTH: this.textureWidth,
    };
  }

  flushTableToTexture() {
    this._texture.update(this.table, 0, 0, this.textureWidth, this.textureWidth);
  }

  /*
    Should throw an error if the provided key is not valid (e.g., because it contains
    reserved values).
   */
  abstract checkValidKey(key: K): void;

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

  /*
   The empty key should be either EMPTY_KEY_VALUE or a tuple in the form of
   [EMPTY_KEY_VALUE, EMPTY_KEY_VALUE, ..., EMPTY_KEY_VALUE].
   */
  abstract getEmptyKey(): K;

  /*
   The empty value should be either EMPTY_KEY_VALUE or a tuple in the form of
   [EMPTY_KEY_VALUE, EMPTY_KEY_VALUE, ..., EMPTY_KEY_VALUE].
   */
  abstract getEmptyValue(): V;

  private rehash(rehashAttempt: number): void {
    const oldTable = this.table;

    this.initializeTableArray();

    for (
      let offset = 0;
      offset < this.entryCapacity * this.getClass().getElementsPerEntry();
      offset += this.getClass().getElementsPerEntry()
    ) {
      if (oldTable[offset] === EMPTY_KEY_VALUE) {
        continue;
      }
      const [key, value] = this.getEntryAtAddress(
        offset / this.getClass().getElementsPerEntry(),
        oldTable,
      );
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

  getValueAtAddress(key: K, hashedAddress: number): V | null {
    const [foundKey, foundValue] = this.getEntryAtAddress(hashedAddress);
    const doesAddressContainKey = this._areKeysEqual(foundKey, key);
    if (doesAddressContainKey) {
      return foundValue;
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
      const offset = hashedAddress * this.getClass().getElementsPerEntry();
      const texelOffset = offset / this.getClass().getTextureChannelCount();
      this._texture.update(
        this.table.subarray(offset, offset + this.getClass().getElementsPerEntry()),
        texelOffset % this.textureWidth,
        Math.floor(texelOffset / this.textureWidth),
        this.getClass().getElementsPerEntry() / this.getClass().getTextureChannelCount(),
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

    value >>>= 0;

    state >>>= 0;

    value = Math.imul(value, k1) >>> 0;

    value = ((value << 15) | (value >>> 17)) >>> 0;

    value = Math.imul(value, k2) >>> 0;

    state = (state ^ value) >>> 0;

    state = ((state << 13) | (state >>> 19)) >>> 0;

    state = (state * 5 + 0xe6546b64) >>> 0;
    return state;
  }

  abstract _hashKeyToAddress(seed: number, key: K): number;
}

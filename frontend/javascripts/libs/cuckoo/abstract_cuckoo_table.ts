import type UpdatableTexture from "libs/UpdatableTexture";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import * as THREE from "three";

const DEFAULT_LOAD_FACTOR = 0.9;
export const EMPTY_KEY_VALUE = 2 ** 32 - 1;
const REHASH_THRESHOLD = 20;

export type SeedSubscriberFn = (seeds: number[]) => void;

let cachedNullTexture: UpdatableTexture | undefined;

export abstract class AbstractCuckooTable<K, V, Entry extends [K, V]> {
  entryCapacity: number;
  protected table!: Uint32Array;
  protected seeds!: number[];
  protected seedSubscribers: Array<SeedSubscriberFn> = [];
  _texture: UpdatableTexture;
  protected textureWidth: number;
  protected autoTextureUpdate: boolean = true;

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
    return Math.floor(this.entryCapacity * DEFAULT_LOAD_FACTOR);
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

  disableAutoTextureUpdate() {
    this.autoTextureUpdate = false;
  }

  enableAutoTextureUpdateAndFlush() {
    this.autoTextureUpdate = true;
    this.flushTableToTexture();
  }

  /*
    Should throw an error if the provided key is not valid (e.g., because it contains
    reserved values).
   */
  abstract checkValidKey(key: K): void;

  set(pendingKey: K, pendingValue: V) {
    const newDisplacedEntry = this.internalSet(pendingKey, pendingValue, !this.autoTextureUpdate);
    if (newDisplacedEntry == null) {
      // Success
      return;
    }
    const oldTable = this.table;
    for (let rehashAttempt = 1; rehashAttempt <= REHASH_THRESHOLD; rehashAttempt++) {
      if (this.rehash(oldTable, true)) {
        if (this.internalSet(newDisplacedEntry[0], newDisplacedEntry[1], true) == null) {
          // Since a rehash was performed, the incremental texture updates were
          // skipped. Update the entire texture if configured.
          if (this.autoTextureUpdate) {
            this.flushTableToTexture();
          }
          return;
        }
      }
    }
    throw new Error(
      `Cannot rehash, since ${REHASH_THRESHOLD} attempts were exceeded. Is the capacity exceeded?`,
    );
  }

  private internalSet(
    pendingKey: K,
    pendingValue: V,
    skipTextureUpdate: boolean,
  ): Entry | undefined | null {
    this.checkValidKey(pendingKey);
    let displacedEntry;
    let currentAddress;
    let iterationCounter = 0;

    const existingValueWithAddress = this.getWithAddress(pendingKey);
    if (existingValueWithAddress) {
      // The key already exists. We only have to overwrite
      // the corresponding value.
      const [, address] = existingValueWithAddress;
      this.writeEntryAtAddress(pendingKey, pendingValue, address, skipTextureUpdate);
      return null;
    }

    let seedIndex = Math.floor(Math.random() * this.seeds.length);
    while (iterationCounter++ < this.entryCapacity) {
      const seed = this.seeds[seedIndex];
      currentAddress = this._hashKeyToAddress(seed, pendingKey);

      // Swap pendingKey, pendingValue with what's contained in H1
      displacedEntry = this.writeEntryAtAddress(
        pendingKey,
        pendingValue,
        currentAddress,
        skipTextureUpdate,
      );

      if (this.canDisplacedEntryBeIgnored(displacedEntry[0], pendingKey)) {
        return null;
      }

      [pendingKey, pendingValue] = displacedEntry;

      // Pick another random seed for the next swap
      seedIndex =
        (seedIndex + Math.floor(Math.random() * (this.seeds.length - 1)) + 1) % this.seeds.length;
    }

    return displacedEntry;
  }

  unset(key: K) {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        this.writeEntryAtAddress(
          this.getEmptyKey(),
          this.getEmptyValue(),
          hashedAddress,
          !this.autoTextureUpdate,
        );
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

  private rehash(oldTable: Uint32Array, skipTextureUpdate: boolean): boolean {
    // Theoretically, one could avoid allocating a new table on repeated rehashes,
    // but these are likely not a bottleneck.
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
      if (this.internalSet(key, value, skipTextureUpdate) != null) {
        // Rehash did not work
        return false;
      }
    }
    return true;
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

  writeEntryAtAddress(key: K, value: V, hashedAddress: number, skipTextureUpdate: boolean): Entry {
    const displacedEntry: Entry = this.getEntryAtAddress(hashedAddress);
    this.writeEntryToTable(key, value, hashedAddress);

    if (!skipTextureUpdate) {
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

  getDiminishedEntryCapacity(): number {
    // Important:
    // This method is only needed for CuckooTable subclasses that
    // use a single 32-bit key.
    // We pretend that the entryCapacity has one
    // slot less than it actually has. This is a shortcut to
    // avoid that a single _hashCombine call in combination with
    // a power-of-two-modulo operation does not have good enough
    // hash properties. Without this, filling the table up to 90%
    // will not work reliably (unit tests well, too). As an
    // alternative, one could also use the fmix finalize step by Murmur3,
    // but this requires more bit operations on CPU and GPU.
    // The downside of this approach is that we waste one slot of the
    // hash table.
    // Other cuckootable implementations don't need this trick, because
    // they call _hashCombine multiple times.
    return this.entryCapacity - 1;
  }
}

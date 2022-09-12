import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { Vector3 } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";

const ELEMENTS_PER_ENTRY = 4;
const TEXTURE_CHANNEL_COUNT = 4;
const DEFAULT_LOAD_FACTOR = 0.25;
const EMPTY_KEY = 2 ** 32 - 1;

type Entry = [number, Vector3];

export type SeedSubscriberFn = (seeds: number[]) => void;

let cachedNullTexture: UpdatableTexture | undefined;

export class CuckooTable {
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
      TEXTURE_CHANNEL_COUNT,
      THREE.UnsignedIntType,
      getRenderer(),
      THREE.RGBAIntegerFormat,
    );
    // This is needed so that the initialization of the texture
    // can be done with an Image-like object ({ width, height, data })
    // which is needed for integer textures, since createImageData results
    // cannot be used for the combination THREE.UnsignedIntType + THREE.RGBAIntegerFormat.
    // See the definition of texImage2D here: https://registry.khronos.org/webgl/specs/latest/2.0/
    // Note that there are two overloads of texImage2D.
    this._texture.isDataTexture = true;
    // The internal format has to be set manually, since ThreeJS does not
    // derive this value by itself.
    // See https://webgl2fundamentals.org/webgl/lessons/webgl-data-textures.html
    // for a reference of the internal formats.
    this._texture.internalFormat = "RGBA32UI";

    this.entryCapacity = Math.floor(
      (textureWidth ** 2 * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY,
    );

    this.initializeTableArray();
  }

  static fromCapacity(requestedCapacity: number): CuckooTable {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return new CuckooTable(textureWidth);
  }

  static getNullTexture(): UpdatableTexture {
    if (cachedNullTexture) {
      return cachedNullTexture;
    }
    cachedNullTexture = createUpdatableTexture(
      0,
      TEXTURE_CHANNEL_COUNT,
      THREE.UnsignedIntType,
      getRenderer(),
      THREE.RGBAIntegerFormat,
    );
    cachedNullTexture.isDataTexture = true;
    cachedNullTexture.internalFormat = "RGBA32UI";

    return cachedNullTexture;
  }

  private initializeTableArray() {
    this.table = new Uint32Array(ELEMENTS_PER_ENTRY * this.entryCapacity).fill(EMPTY_KEY);

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

  clearAll() {
    this.table.fill(EMPTY_KEY);
    this._texture.update(this.table, 0, 0, this.textureWidth, this.textureWidth);
  }

  set(pendingKey: number, pendingValue: Vector3, rehashAttempt: number = 0) {
    if (pendingKey === EMPTY_KEY) {
      throw new Error(`The key ${EMPTY_KEY} is not allowed for the CuckooTable.`);
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
    this._texture.update(this.table, 0, 0, this.textureWidth, this.textureWidth);
  }

  unset(key: number) {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        console.log(`clear ${key} at ${hashedAddress}`);
        this.writeEntryAtAddress(
          EMPTY_KEY,
          [EMPTY_KEY, EMPTY_KEY, EMPTY_KEY],
          hashedAddress,
          false,
        );
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
      if (oldTable[offset] === EMPTY_KEY) {
        continue;
      }
      const key: number = oldTable[offset];
      const value: Vector3 = [oldTable[offset + 1], oldTable[offset + 2], oldTable[offset + 3]];
      this.set(key, value, rehashAttempt);
    }
  }

  get(key: number): Vector3 {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        return value;
      }
    }
    return [-1, -1, -1];
  }

  getEntryAtAddress(hashedAddress: number): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    return [
      this.table[offset],
      [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]],
    ];
  }

  private canDisplacedEntryBeIgnored(displacedKey: number, newKey: number): boolean {
    return (
      // Either, the slot is empty...
      // -1 is not allowed as a key
      displacedKey === EMPTY_KEY ||
      // or the slot already refers to the key
      displacedKey === newKey
    );
  }

  doesAddressContainKey(key: number, hashedAddress: number): boolean {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    return this.table[offset] === key;
  }

  getValueAtAddress(key: number, hashedAddress: number): Vector3 | null {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    if (this.doesAddressContainKey(key, hashedAddress)) {
      return [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]];
    } else {
      return null;
    }
  }

  private writeEntryAtAddress(
    key: number,
    value: Vector3,
    hashedAddress: number,
    isRehashing: boolean,
  ): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    const texelOffset = offset / TEXTURE_CHANNEL_COUNT;

    console.log(`write ${key} with ${value} to ${hashedAddress}`);

    const displacedEntry: Entry = [
      this.table[offset],
      [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]],
    ];

    this.table[offset] = key;
    this.table[offset + 1] = value[0];
    this.table[offset + 2] = value[1];
    this.table[offset + 3] = value[2];

    if (!isRehashing) {
      // Only partially update if we are not rehashing. Otherwise, it makes more
      // sense to flush the entire texture content after the rehashing is done.
      this._texture.update(
        this.table.subarray(offset, offset + ELEMENTS_PER_ENTRY),
        texelOffset % this.textureWidth,
        Math.floor(texelOffset / this.textureWidth),
        1,
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

  _hashKeyToAddress(seed: number, key: number): number {
    const state = this._hashCombine(seed, key);

    return state % this.entryCapacity;
  }
}

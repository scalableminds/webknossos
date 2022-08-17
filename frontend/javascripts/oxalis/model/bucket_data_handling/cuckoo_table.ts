import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import { Vector3 } from "oxalis/constants";
import { getRenderer } from "oxalis/controller/renderer";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";

const ELEMENTS_PER_ENTRY = 4;
const TEXTURE_CHANNEL_COUNT = 4;
const DEFAULT_LOAD_FACTOR = 0.25;

type Entry = [number, Vector3];

export type SeedSubscriberFn = (seeds: number[]) => void;

export class CuckooTable {
  entryCapacity: number;
  table!: Float32Array;
  seeds!: number[];
  seedSubscribers: Array<SeedSubscriberFn> = [];
  _texture: UpdatableTexture;
  textureWidth: number;

  setCount: number = 0;

  constructor(textureWidth: number) {
    this.textureWidth = textureWidth;
    this._texture = createUpdatableTexture(
      textureWidth,
      TEXTURE_CHANNEL_COUNT,
      THREE.FloatType,
      getRenderer(),
    );
    this.entryCapacity = Math.floor(
      (textureWidth ** 2 * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY,
    );
    console.log("this.entryCapacity", this.entryCapacity);

    this.initialize();
  }

  static fromCapacity(requestedCapacity: number): CuckooTable {
    const capacity = requestedCapacity / DEFAULT_LOAD_FACTOR;
    const textureWidth = Math.ceil(
      Math.sqrt((capacity * TEXTURE_CHANNEL_COUNT) / ELEMENTS_PER_ENTRY),
    );
    return new CuckooTable(textureWidth);
  }

  private initialize() {
    this.table = new Float32Array(ELEMENTS_PER_ENTRY * this.entryCapacity).fill(-1);

    // The chance of colliding seeds is lower than 9.32e-10 which is why
    // we ignore this case (a rehash will happen automatically).
    this.seeds = [
      Math.floor(32768 * Math.random()),
      Math.floor(32768 * Math.random()),
      Math.floor(32768 * Math.random()),
    ];
    this.notifySeedListeners();
  }

  getTexture(): UpdatableTexture {
    return this._texture;
  }

  subscribeToSeeds(fn: SeedSubscriberFn): void {
    this.seedSubscribers.push(fn);
    this.notifySeedListeners();
  }

  notifySeedListeners() {
    this.seedSubscribers.forEach((fn) => fn(this.seeds));
  }

  clearAll() {
    this.table.fill(-1);
  }

  set(pendingKey: number, pendingValue: Vector3, rehashAttempt: number = 0) {
    // todo: check that repeated sets to same key work

    console.log("set");

    if (rehashAttempt === 0) {
      this.setCount++;
    }
    let displacedEntry;
    let currentAddress;
    let iterationCounter = 0;

    const ITERATION_THRESHOLD = 40;
    const REHASH_THRESHOLD = 100;
    if (rehashAttempt > 5) {
      console.log("rehashing 5 times in a row.");
    }
    if (rehashAttempt >= REHASH_THRESHOLD) {
      throw new Error(
        `Cannot rehash, since this is already the ${rehashAttempt}th attempt. set was called ${this.setCount}th times by the user.`,
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

  private rehash(rehashAttempt: number): void {
    // console.log("############################### rehashing");
    const oldTable = this.table;

    this.initialize();

    for (
      let offset = 0;
      offset < this.entryCapacity * ELEMENTS_PER_ENTRY;
      offset += ELEMENTS_PER_ENTRY
    ) {
      if (oldTable[offset] === 0) {
        continue;
      }
      const key: number = oldTable[offset + 0];
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

  // hasEntry(key: number, value: number, hashedAddress1: number, hashedAddress2: number): boolean {
  //   return this.isEntry(key, value, hashedAddress1) || this.isEntry(key, value, hashedAddress2);
  // }

  getEntryAtAddress(hashedAddress: number): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    return [
      this.table[offset + 0],
      [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]],
    ];
  }

  private canDisplacedEntryBeIgnored(displacedKey: number, newKey: number): boolean {
    return (
      // Either, the slot is empty...
      // -1, -1, -1, -1 is not allowed as a key
      displacedKey === -1 ||
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

    const displacedEntry: Entry = [
      this.table[offset + 0],
      [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]],
    ];

    // console.log("writing key=", key, "value=", value, "to", offset);

    this.table[offset] = key;
    this.table[offset + 1] = value[0];
    this.table[offset + 2] = value[1];
    this.table[offset + 3] = value[2];

    if (!isRehashing) {
      // Only partially update if we are not rehashing. Otherwise, it makes more
      // sense to flush the entire texture content after the rehashing is done.
      this._texture.update(
        this.table.slice(offset, offset + ELEMENTS_PER_ENTRY),
        texelOffset % this.textureWidth,
        Math.floor(texelOffset / this.textureWidth),
        1,
        1,
      );
    }

    return displacedEntry;
  }

  _hashCombine(state: number, value: number) {
    // Based on Murmur3_32
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

// if (typeof window !== undefined) {
//   window.CuckooTable = CuckooTable;
// }

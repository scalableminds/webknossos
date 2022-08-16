import UpdatableTexture from "libs/UpdatableTexture";
import { Vector2, Vector3 } from "oxalis/constants";

const ELEMENTS_PER_ENTRY = 4;

type Entry = [number, Vector3];

export type SeedSubscriberFn = (seeds: number[]) => void;

export class CuckooTable {
  entryCapacity: number;
  table!: Float32Array;
  seeds!: number[];
  seedSubscribers: Array<SeedSubscriberFn> = [];
  texture: UpdatableTexture;

  setCount: number = 0;

  constructor(textureWidth: number, texture: UpdatableTexture) {
    this.entryCapacity = Math.floor((textureWidth ** 2 * 4) / ELEMENTS_PER_ENTRY);
    console.log("this.entryCapacity", this.entryCapacity);
    this.texture = texture;
    this.initialize();
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

    if (rehashAttempt == 0) {
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
      displacedEntry = this.writeEntryAtAddress(pendingKey, pendingValue, currentAddress);

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

  get(key: number): Vector2 {
    for (const seed of this.seeds) {
      const hashedAddress = this._hashKeyToAddress(seed, key);

      const value = this.getValueAtAddress(key, hashedAddress);
      if (value != null) {
        return value;
      }
    }
    return [-1, -1];
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

  getValueAtAddress(key: number, hashedAddress: number): Vector2 | null {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;
    if (this.doesAddressContainKey(key, hashedAddress)) {
      return [this.table[offset + 4], this.table[offset + 5]];
    } else {
      return null;
    }
  }

  private writeEntryAtAddress(key: number, value: Vector3, hashedAddress: number): Entry {
    const offset = hashedAddress * ELEMENTS_PER_ENTRY;

    const displacedEntry: Entry = [
      this.table[offset + 0],
      [this.table[offset + 1], this.table[offset + 2], this.table[offset + 3]],
    ];

    console.log("writing key=", key, "value=", value, "to", offset);

    // eslint-disable-next-line prefer-destructuring
    this.table[offset] = key;
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 1] = value[0];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 2] = value[1];
    // eslint-disable-next-line prefer-destructuring
    this.table[offset + 3] = value[2];

    this.texture.update(this.table, 0, 0, 4096, 4096);

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
    console.log("using seed", seed);
    const state = this._hashCombine(seed, key);

    return state % this.entryCapacity;
  }
}

// if (typeof window !== undefined) {
//   window.CuckooTable = CuckooTable;
// }

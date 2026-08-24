import type { BucketJournal } from "./journal";
import {
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type BucketKey,
  bucketKey,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "./types";
import type { BucketWrites } from "./write_set";

export type BucketState = "absent" | "pending" | "resident";

/** What the cube fetches from. Tests supply an in-memory implementation. */
export interface BackendLike {
  fetchBucket(address: BucketAddress): Promise<{ data: BigUint64Array; version: number }>;
}

interface CubeEntry {
  address: BucketAddress;
  state: BucketState;
  /** Allocated as soon as the bucket becomes `pending`. */
  data: BigUint64Array;
  fetch: Promise<void> | null;
}

/**
 * The in-memory, renderable representation. One 32³ array per materialized
 * bucket, lazily fetched, feeding the GPU.
 *
 * Two rules the architecture adds:
 *   - Materialization is a *rendering* decision, never a writing one. Writes are
 *     recorded against bucket addresses whether or not the bucket is in memory.
 *   - On load, the journal folds local entries over the fetched data. The cube
 *     does not merge anything itself.
 */
export class WorkingDataCube {
  private readonly buckets = new Map<BucketKey, CubeEntry>();
  /** Buckets whose texture would need re-uploading. Tests assert on this. */
  readonly gpuDirty = new Set<BucketKey>();
  fetchCount = 0;

  constructor(
    private readonly backend: BackendLike,
    private readonly journal: BucketJournal,
  ) {}

  state(address: BucketAddress): BucketState {
    return this.buckets.get(bucketKey(address))?.state ?? "absent";
  }

  /**
   * Dense content of a *resident* bucket. Returns undefined for `absent` and
   * for `pending` buckets alike: a zero-filled placeholder must never be
   * mistaken for "all background". Never triggers a fetch.
   */
  getResident(address: BucketAddress): BigUint64Array | undefined {
    const entry = this.buckets.get(bucketKey(address));
    return entry?.state === "resident" ? entry.data : undefined;
  }

  /**
   * The array to write through to for live feedback, if one exists. Unlike
   * getResident this also returns `pending` buckets, because writing into a
   * placeholder is fine — the fold on arrival replays those writes.
   */
  private materializedData(address: BucketAddress): BigUint64Array | undefined {
    return this.buckets.get(bucketKey(address))?.data;
  }

  /** absent → pending, and start the fetch. Idempotent. */
  materialize(address: BucketAddress): Promise<void> {
    const key = bucketKey(address);
    let entry = this.buckets.get(key);
    if (entry == null) {
      entry = {
        address,
        state: "pending",
        data: new BigUint64Array(BUCKET_VOXEL_COUNT),
        fetch: null,
      };
      this.buckets.set(key, entry);
    }
    if (entry.state === "resident") return Promise.resolve();
    if (entry.fetch != null) return entry.fetch;

    this.fetchCount++;
    const currentEntry = entry;
    entry.fetch = this.backend.fetchBucket(address).then(({ data, version }) => {
      this.receiveData(address, data, version);
      currentEntry.fetch = null;
    });
    return entry.fetch;
  }

  /**
   * Install fetched backend data. The journal performs the fold; the cube only
   * installs the result. The zero-filled placeholder a pending bucket was
   * carrying is replaced outright rather than merged — re-folding from a known
   * base is both simpler and correct.
   */
  receiveData(address: BucketAddress, backendData: BigUint64Array, version: number): void {
    const key = bucketKey(address);
    const entry = this.buckets.get(key);
    this.journal.setBase(address, backendData, version);
    const folded = this.journal.foldOntoFetched(address, backendData, version);
    if (entry == null) {
      this.buckets.set(key, { address, state: "resident", data: folded, fetch: null });
    } else {
      entry.data = folded;
      entry.state = "resident";
    }
    this.gpuDirty.add(key);
  }

  /** Load a bucket and return its content. The resolver's blocking read. */
  async ensureLoaded(address: BucketAddress): Promise<BigUint64Array> {
    if (this.state(address) !== "resident") await this.materialize(address);
    const data = this.getResident(address);
    if (data == null) throw new Error(`Bucket ${bucketKey(address)} did not become resident`);
    return data;
  }

  /**
   * Apply a bucket's writes at once, walking the mask's runs. A no-op when the
   * bucket is not materialized — the diff still exists in the write set and the
   * journal, and will be folded in whenever the bucket is eventually loaded.
   */
  applyWrites(address: BucketAddress, writes: BucketWrites): void {
    const data = this.materializedData(address);
    if (data == null) return;
    for (const { start, length } of writes.mask.runs()) {
      data.fill(writes.value, start, start + length);
    }
    this.gpuDirty.add(bucketKey(address));
  }

  /** Overwrite a bucket's content outright (undo rebuild). */
  install(address: BucketAddress, data: BigUint64Array): void {
    const key = bucketKey(address);
    const entry = this.buckets.get(key);
    if (entry == null) return; // not materialized: nothing on screen to update
    entry.data = data;
    this.gpuDirty.add(key);
  }

  /** Read one voxel of a resident bucket. Test helper, not a hot path. */
  peek(voxel: Vector3, magIndex: number): SegmentId | undefined {
    const address: BucketAddress = [
      Math.floor(voxel[0] / 32),
      Math.floor(voxel[1] / 32),
      Math.floor(voxel[2] / 32),
      magIndex,
    ];
    const data = this.getResident(address);
    if (data == null) return undefined;
    const [x, y, z] = voxelOffsetInBucket(voxel);
    return data[voxelIndexOf(x, y, z)];
  }

  materializedAddresses(): BucketAddress[] {
    return [...this.buckets.values()].map((entry) => entry.address);
  }
}

/** A trivial in-memory backend. Buckets not explicitly seeded read as empty. */
export class FakeBackend implements BackendLike {
  private readonly seeded = new Map<BucketKey, BigUint64Array>();
  version = 0;
  readonly fetched: BucketAddress[] = [];

  /** Pre-populate a bucket with data the frontend will later fetch. */
  seed(address: BucketAddress, data: BigUint64Array): void {
    this.seeded.set(bucketKey(address), data);
  }

  seedVoxel(address: BucketAddress, offset: Vector3, value: SegmentId): void {
    const key = bucketKey(address);
    let data = this.seeded.get(key);
    if (data == null) {
      data = new BigUint64Array(BUCKET_VOXEL_COUNT);
      this.seeded.set(key, data);
    }
    data[voxelIndexOf(offset[0], offset[1], offset[2])] = value;
  }

  async fetchBucket(address: BucketAddress): Promise<{ data: BigUint64Array; version: number }> {
    this.fetched.push(address);
    const seeded = this.seeded.get(bucketKey(address));
    const data = seeded != null ? seeded.slice() : new BigUint64Array(BUCKET_VOXEL_COUNT);
    return { data, version: this.version };
  }
}

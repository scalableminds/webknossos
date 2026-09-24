/**
 * NOT YET INTEGRATED — an in-memory stand-in for the real `DataCube`, so the
 * core can be exercised without the viewer. Production goes through
 * `integration/wk_cube_adapter.ts` instead. See ./index.ts for this folder's
 * rule: nothing here may be imported from production code.
 */

import { applyBucketWriteToData, type BucketWrite } from "../core/bucket_write_map";
import type { BackendLike, BucketState, LoadingVoxelCube } from "../core/cube";
import {
  type AdditionalCoordinate,
  BUCKET_VOXEL_COUNT,
  type BucketAddress,
  type BucketKey,
  bucketKey,
  type DenseBucketData,
  type SegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "../core/types";
import type { BucketJournal } from "./journal";

interface CubeEntry {
  address: BucketAddress;
  state: BucketState;
  /** Allocated as soon as the bucket becomes `pending`. */
  data: DenseBucketData;
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
export class WorkingDataCube implements LoadingVoxelCube {
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
   * Dense content of a *loaded* bucket. Returns undefined for `absent` and
   * for `pending` buckets alike: a zero-filled placeholder must never be
   * mistaken for "all background". Never triggers a fetch.
   */
  getLoadedDataOrUndefined(address: BucketAddress): DenseBucketData | undefined {
    const entry = this.buckets.get(bucketKey(address));
    return entry?.state === "loaded" ? entry.data : undefined;
  }

  /**
   * The array to write through to for live feedback, if one exists. Unlike
   * getLoadedDataOrUndefined this also returns `pending` buckets, because
   * writing into a placeholder is fine — the fold on arrival replays those
   * writes.
   */
  private materializedData(address: BucketAddress): DenseBucketData | undefined {
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
    if (entry.state === "loaded") return Promise.resolve();
    if (entry.fetch != null) return entry.fetch;

    this.fetchCount++;
    const currentEntry = entry;
    entry.fetch = this.backend
      .fetchBucket(address)
      .then(({ data, version }) => {
        this.receiveData(address, data, version);
      })
      .finally(() => {
        // Cleared on failure too, not just on success: a cached rejected
        // promise would turn a transient backend failure into a permanent one,
        // because every later materialize() would hand back that same
        // rejection instead of retrying. The entry stays `pending` so its
        // placeholder — and anything already written into it — survives.
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
  receiveData(address: BucketAddress, backendData: DenseBucketData, version: number): void {
    const key = bucketKey(address);
    const entry = this.buckets.get(key);
    this.journal.setBase(address, backendData, version);
    const folded = this.journal.foldOntoFetched(address, backendData, version);
    if (entry == null) {
      this.buckets.set(key, { address, state: "loaded", data: folded, fetch: null });
    } else {
      entry.data = folded;
      entry.state = "loaded";
    }
    this.gpuDirty.add(key);
  }

  /** Load a bucket and return its content. The resolver's blocking read. */
  async ensureLoaded(address: BucketAddress): Promise<DenseBucketData> {
    if (this.state(address) !== "loaded") await this.materialize(address);
    const data = this.getLoadedDataOrUndefined(address);
    if (data == null) throw new Error(`Bucket ${bucketKey(address)} did not become loaded`);
    return data;
  }

  /**
   * Apply a bucket's writes at once, walking the mask's runs. A no-op when the
   * bucket is not materialized — the diff still exists in the write set and the
   * journal, and will be folded in whenever the bucket is eventually loaded.
   */
  applyWrites(address: BucketAddress, write: BucketWrite): void {
    const data = this.materializedData(address);
    if (data == null) return;
    applyBucketWriteToData(data, write);
    this.gpuDirty.add(bucketKey(address));
  }

  backgroundProbe(address: BucketAddress): ((index: number) => boolean) | null {
    const data = this.getLoadedDataOrUndefined(address);
    if (data == null) return null;
    return (index: number) => data[index] === 0n;
  }

  /** Overwrite a bucket's content outright (undo rebuild). */
  install(address: BucketAddress, data: DenseBucketData): void {
    const key = bucketKey(address);
    const entry = this.buckets.get(key);
    if (entry == null) return; // not materialized: nothing on screen to update
    entry.data = data;
    this.gpuDirty.add(key);
  }

  /** Read one voxel of a loaded bucket. Test helper, not a hot path. */
  peek(
    voxel: Vector3,
    magIndex: number,
    additionalCoordinates: AdditionalCoordinate[] | null = null,
  ): SegmentId | undefined {
    const address: BucketAddress = [
      Math.floor(voxel[0] / 32),
      Math.floor(voxel[1] / 32),
      Math.floor(voxel[2] / 32),
      magIndex,
      additionalCoordinates,
    ];
    const data = this.getLoadedDataOrUndefined(address);
    if (data == null) return undefined;
    const [x, y, z] = voxelOffsetInBucket(voxel);
    return data[voxelIndexOf(x, y, z)];
  }
}

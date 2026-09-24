import type { BucketDataArray } from "types/api_types";
import { type BucketWriteMap, BucketWriteMapBuilder } from "./bucket_write_map";
import type { LoadingVoxelCube } from "./cube";
import type { DataDependentShape } from "./intents";
import {
  type BoundingBox,
  type BucketAddress,
  bucketAddressOfVoxel,
  bucketIndexOfCoordinate,
  type EditContext,
  isInBoundingBox,
  type StoredSegmentId,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "./types";

/**
 * Resolves data-dependent intents into a write set.
 *
 * The only component permitted to await a bucket load. Keeping the awaiting
 * here is what lets the rasterizer stay synchronous, pure and worker-friendly.
 *
 * Note there is no intermediate shape: resolution *is* rasterization for these
 * tools. A traversal naturally works bucket by bucket, which is exactly the
 * shape of a BucketWriteMap, so it writes into one as it goes.
 */
export async function resolve(
  shape: DataDependentShape,
  ctx: EditContext,
  cube: LoadingVoxelCube,
  signal?: AbortSignal,
): Promise<BucketWriteMap> {
  switch (shape.kind) {
    case "floodFill":
      return (await resolveFloodFill(shape, ctx, cube, signal)).bucketWrites;
  }
}

/** Guards against a fill escaping into the whole layer when bounds are null. */
export const DEFAULT_MAX_VISITED_VOXELS = 5_000_000;

export interface FloodFillOptions {
  maxVisitedVoxels?: number;
}

export interface FloodFillResolution {
  bucketWrites: BucketWriteMap;
  /**
   * True iff the traversal reached a voxel it would otherwise have continued
   * into (unvisited, matching the seed) but for `shape.bounds` — i.e. the
   * fill's true extent may be larger than what got written. Always false when
   * `shape.bounds` is null, since there is then nothing to exceed. Callers
   * that need to warn the user, or that today create a bounding box marking
   * the covered region so its borders can be checked manually (mirroring the
   * pre-existing `wasBoundingBoxExceeded` in `data_cube.ts`'s own floodFill),
   * key off this.
   */
  wasBoundingBoxExceeded: boolean;
  /**
   * Tight bounding box (source-mag voxel space, max exclusive) around every
   * voxel actually written. Null when nothing was written — including the
   * seed-already-matches no-op below, where there is nothing to bound.
   */
  coveredBoundingBox: BoundingBox | null;
}

async function resolveFloodFill(
  shape: FloodFillShape,
  ctx: EditContext,
  cube: LoadingVoxelCube,
  signal?: AbortSignal,
  options: FloodFillOptions = {},
): Promise<FloodFillResolution> {
  return new FloodFillTraversal(shape, ctx, cube, signal, options).run();
}

type FloodFillShape = Extract<DataDependentShape, { kind: "floodFill" }>;

/**
 * One FloodFillTraversal instance describes one flood fill in progress.
 *
 * The per-voxel steps are deliberately split into a synchronous part and an
 * asynchronous one (`hasCachedBucketFor` / `loadBucketFor`). This avoids
 * calling an `async` helper once per visited voxel (which is expensive).
 */
class FloodFillTraversal {
  private readonly out: BucketWriteMapBuilder;
  private readonly maxVisited: number;
  private readonly queue: Vector3[];

  private visited = 0;
  private wasBoundingBoxExceeded = false;
  private coveredMin: Vector3 | null = null;
  private coveredMax: Vector3 | null = null;

  /**
   * The bucket most recently read, so a run of neighbours inside one bucket
   * does not re-enter the async path.
   */
  private cachedAddress: BucketAddress | null = null;
  // `cachedData` can be null even when `cachedAddress` is not null
  // (in that case, no data exists at that address).
  private cachedData: BucketDataArray | null = null;

  constructor(
    private readonly shape: FloodFillShape,
    private readonly ctx: EditContext,
    private readonly cube: LoadingVoxelCube,
    private readonly signal: AbortSignal | undefined,
    options: FloodFillOptions,
  ) {
    this.out = new BucketWriteMapBuilder(
      ctx.sourceMagIndex,
      ctx.activeSegmentId,
      ctx.additionalCoordinates,
    );
    this.maxVisited = options.maxVisitedVoxels ?? DEFAULT_MAX_VISITED_VOXELS;
    this.queue = [shape.seed];
  }

  async run(): Promise<FloodFillResolution> {
    const seedValue = await this.readSeedValue();
    if (seedValue == null) {
      // The seed sits outside the dataset. Nothing to read, nothing to fill.
      return this.result();
    }

    if (BigInt(seedValue) === this.ctx.activeSegmentId) {
      // Nothing to do: the region already carries the target value..
      return this.result();
    }

    while (this.queue.length > 0) {
      this.signal?.throwIfAborted();
      const voxel = this.queue.pop() as Vector3;
      if (!this.shouldExplore(voxel)) continue;

      if (!this.hasCachedBucketFor(voxel)) await this.loadBucketFor(voxel); // the only await
      // No bucket at this address.
      if (this.cachedData == null) continue;
      if (this.readCachedVoxel(voxel) !== seedValue) continue;

      this.accept(voxel);
    }

    return this.result();
  }

  /** Null when the seed's bucket lies outside the dataset. */
  private async readSeedValue(): Promise<StoredSegmentId | null> {
    const { seed } = this.shape;
    await this.loadBucketFor(seed);
    return this.cachedData == null ? null : this.readCachedVoxel(seed);
  }

  /**
   * Whether the voxel is still a candidate at all. Also responsible for
   * setting `wasBoundingBoxExceeded`.
   */
  private shouldExplore(voxel: Vector3): boolean {
    if (!isInBoundingBox(voxel, this.shape.bounds)) {
      this.wasBoundingBoxExceeded = true;
      return false;
    }
    if (!isInBoundingBox(voxel, this.ctx.editableBoundingBox)) {
      // This is the annotation-level bounding box. Don't set wasBoundingBoxExceeded.
      return false;
    }
    return !this.out.has(voxel); // the mask doubles as the visited set
  }

  /**
   * Compares bucket coordinates directly rather than building a BucketAddress
   * to compare against: this runs once per visited voxel and hits far more
   * often than it misses, so the tuple would be allocated and discarded. The
   * address's other two components need no comparison — mag index and
   * additional coordinates are fixed for the whole traversal.
   *
   * Together with `bucketAddressOfVoxel` and `voxelOffsetInBucket`, whose
   * shift/mask forms this shares, dropping the divisions measured 10-26% off a
   * 100k-voxel 2D fill (and a wash on a 1M-voxel 3D one, where allocating the
   * neighbour tuples dominates).
   */
  private hasCachedBucketFor(voxel: Vector3): boolean {
    const cached = this.cachedAddress;
    return (
      cached != null &&
      cached[0] === bucketIndexOfCoordinate(voxel[0]) &&
      cached[1] === bucketIndexOfCoordinate(voxel[1]) &&
      cached[2] === bucketIndexOfCoordinate(voxel[2])
    );
  }

  private async loadBucketFor(voxel: Vector3): Promise<void> {
    const address = bucketAddressOfVoxel(
      voxel,
      this.ctx.sourceMagIndex,
      this.ctx.additionalCoordinates,
    );
    this.cachedData = await this.cube.ensureLoaded(address);
    this.cachedAddress = address;
  }

  /**
   * Only valid once `hasCachedBucketFor(voxel)` holds and `cachedData` is
   * non-null. The value comes back in the layer's own element class; it is
   * only ever compared against another value from this same bucket.
   */
  private readCachedVoxel(voxel: Vector3): StoredSegmentId {
    const offset = voxelOffsetInBucket(voxel);
    return (this.cachedData as BucketDataArray)[voxelIndexOf(offset[0], offset[1], offset[2])];
  }

  /** The voxel is part of the region: write it and walk on from it. */
  private accept(voxel: Vector3): void {
    this.out.mark(voxel);
    this.visited++;
    if (this.visited > this.maxVisited) {
      throw new Error(
        `Flood fill exceeded ${this.maxVisited} voxels. Restrict it with a bounding box.`,
      );
    }
    this.growCoveredBox(voxel);
    this.enqueueNeighbours(voxel);
  }

  private growCoveredBox(voxel: Vector3): void {
    if (this.coveredMin == null || this.coveredMax == null) {
      this.coveredMin = [...voxel];
      this.coveredMax = [voxel[0] + 1, voxel[1] + 1, voxel[2] + 1];
      return;
    }
    for (let axis = 0; axis < 3; axis++) {
      this.coveredMin[axis] = Math.min(this.coveredMin[axis], voxel[axis]);
      this.coveredMax[axis] = Math.max(this.coveredMax[axis], voxel[axis] + 1);
    }
  }

  private enqueueNeighbours(voxel: Vector3): void {
    const [x, y, z] = voxel;
    this.enqueueUnlessBlocked(voxel, [x - 1, y, z]);
    this.enqueueUnlessBlocked(voxel, [x + 1, y, z]);
    this.enqueueUnlessBlocked(voxel, [x, y - 1, z]);
    this.enqueueUnlessBlocked(voxel, [x, y + 1, z]);
    if (this.shape.is3D) {
      this.enqueueUnlessBlocked(voxel, [x, y, z - 1]);
      this.enqueueUnlessBlocked(voxel, [x, y, z + 1]);
    }
  }

  /** `isBlocked` is the "Split Segments" boundary: the fill may not cross it. */
  private enqueueUnlessBlocked(from: Vector3, to: Vector3): void {
    if (this.shape.isBlocked?.(from, to)) return;
    this.queue.push(to);
  }

  private result(): FloodFillResolution {
    const { coveredMin, coveredMax } = this;
    return {
      bucketWrites: this.out.build(),
      wasBoundingBoxExceeded: this.wasBoundingBoxExceeded,
      coveredBoundingBox:
        coveredMin != null && coveredMax != null ? { min: coveredMin, max: coveredMax } : null,
    };
  }
}

export { resolveFloodFill };

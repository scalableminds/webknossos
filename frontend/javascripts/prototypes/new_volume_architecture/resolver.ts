import type { LoadingVoxelCube } from "./cube";
import type { DataDependentShape } from "./intents";
import {
  type BoundingBox,
  type BucketAddress,
  bucketAddressOfVoxel,
  type EditContext,
  isInBoundingBox,
  type Vector3,
  voxelIndexOf,
  voxelOffsetInBucket,
} from "./types";
import { type VoxelWriteSet, WriteSetBuilder } from "./write_set";

/**
 * Resolves data-dependent intents into a write set.
 *
 * The only component permitted to await a bucket load. Keeping the awaiting
 * here is what lets the rasterizer stay synchronous, pure and worker-friendly.
 *
 * Note there is no intermediate shape: resolution *is* rasterization for these
 * tools. A traversal naturally works bucket by bucket, which is exactly the
 * shape of a VoxelWriteSet, so it writes into one as it goes.
 */
export async function resolve(
  shape: DataDependentShape,
  ctx: EditContext,
  cube: LoadingVoxelCube,
  signal?: AbortSignal,
): Promise<VoxelWriteSet> {
  switch (shape.kind) {
    case "floodFill":
      return (await resolveFloodFill(shape, ctx, cube, signal)).writeSet;
  }
}

/** Guards against a fill escaping into the whole layer when bounds are null. */
export const DEFAULT_MAX_VISITED_VOXELS = 5_000_000;

export interface FloodFillOptions {
  maxVisitedVoxels?: number;
}

export interface FloodFillResolution {
  writeSet: VoxelWriteSet;
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
  shape: Extract<DataDependentShape, { kind: "floodFill" }>,
  ctx: EditContext,
  cube: LoadingVoxelCube,
  signal?: AbortSignal,
  options: FloodFillOptions = {},
): Promise<FloodFillResolution> {
  const maxVisited = options.maxVisitedVoxels ?? DEFAULT_MAX_VISITED_VOXELS;
  const out = new WriteSetBuilder(ctx.sourceMagIndex, ctx.activeSegmentId);

  const seedValue = await readVoxel(cube, shape.seed, ctx.sourceMagIndex);
  if (seedValue === ctx.activeSegmentId) {
    // Nothing to do: the region already carries the target value, and treating
    // it as a fill would traverse it only to write what is already there.
    return { writeSet: out.build(), wasBoundingBoxExceeded: false, coveredBoundingBox: null };
  }

  const queue: Vector3[] = [shape.seed];
  let visited = 0;
  let wasBoundingBoxExceeded = false;
  let coveredMin: Vector3 | null = null;
  let coveredMax: Vector3 | null = null;

  // A cache of the bucket most recently read, so a run of neighbours inside one
  // bucket does not re-enter the async path.
  let cachedAddress: BucketAddress | null = null;
  let cachedData: BigUint64Array | null = null;

  while (queue.length > 0) {
    signal?.throwIfAborted();
    const voxel = queue.pop() as Vector3;

    if (!isInBoundingBox(voxel, shape.bounds)) {
      // The neighbour genuinely would have been explored otherwise — this is
      // not "not part of the region", it is "part of the region we did not
      // get to look at". shape.bounds is null for at most maxVisited-style
      // callers, so this never fires when there is nothing to exceed.
      wasBoundingBoxExceeded = true;
      continue;
    }
    if (!isInBoundingBox(voxel, ctx.editableBoundingBox)) continue;
    if (out.has(voxel)) continue; // the mask doubles as the visited set

    const address = bucketAddressOfVoxel(voxel, ctx.sourceMagIndex);
    if (cachedAddress == null || !sameAddress(cachedAddress, address)) {
      cachedData = await cube.ensureLoaded(address); // the only await
      cachedAddress = address;
    }
    const offset = voxelOffsetInBucket(voxel);
    const value = (cachedData as BigUint64Array)[voxelIndexOf(offset[0], offset[1], offset[2])];
    if (value !== seedValue) continue;

    out.mark(voxel);
    visited++;
    if (visited > maxVisited) {
      throw new Error(`Flood fill exceeded ${maxVisited} voxels. Restrict it with a bounding box.`);
    }

    if (coveredMin == null || coveredMax == null) {
      coveredMin = [...voxel];
      coveredMax = [voxel[0] + 1, voxel[1] + 1, voxel[2] + 1];
    } else {
      for (let axis = 0; axis < 3; axis++) {
        coveredMin[axis] = Math.min(coveredMin[axis], voxel[axis]);
        coveredMax[axis] = Math.max(coveredMax[axis], voxel[axis] + 1);
      }
    }

    for (const neighbour of neighbours(voxel, shape.is3D)) {
      if (shape.isBlocked?.(voxel, neighbour)) continue;
      queue.push(neighbour);
    }
  }

  return {
    writeSet: out.build(),
    wasBoundingBoxExceeded,
    coveredBoundingBox:
      coveredMin != null && coveredMax != null ? { min: coveredMin, max: coveredMax } : null,
  };
}

function neighbours(voxel: Vector3, is3D: boolean): Vector3[] {
  const [x, y, z] = voxel;
  const result: Vector3[] = [
    [x - 1, y, z],
    [x + 1, y, z],
    [x, y - 1, z],
    [x, y + 1, z],
  ];
  if (is3D) {
    result.push([x, y, z - 1], [x, y, z + 1]);
  }
  return result;
}

function sameAddress(a: BucketAddress, b: BucketAddress): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

async function readVoxel(
  cube: LoadingVoxelCube,
  voxel: Vector3,
  magIndex: number,
): Promise<bigint> {
  const address = bucketAddressOfVoxel(voxel, magIndex);
  const data = await cube.ensureLoaded(address);
  const offset = voxelOffsetInBucket(voxel);
  return data[voxelIndexOf(offset[0], offset[1], offset[2])];
}

export { resolveFloodFill };

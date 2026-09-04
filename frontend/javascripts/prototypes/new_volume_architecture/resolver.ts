import type { LoadingVoxelCube } from "./cube";
import type { DataDependentShape } from "./intents";
import {
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
      return resolveFloodFill(shape, ctx, cube, signal);
  }
}

/** Guards against a fill escaping into the whole layer when bounds are null. */
export const DEFAULT_MAX_VISITED_VOXELS = 5_000_000;

export interface FloodFillOptions {
  maxVisitedVoxels?: number;
}

async function resolveFloodFill(
  shape: Extract<DataDependentShape, { kind: "floodFill" }>,
  ctx: EditContext,
  cube: LoadingVoxelCube,
  signal?: AbortSignal,
  options: FloodFillOptions = {},
): Promise<VoxelWriteSet> {
  const maxVisited = options.maxVisitedVoxels ?? DEFAULT_MAX_VISITED_VOXELS;
  const out = new WriteSetBuilder(ctx.sourceMagIndex, ctx.activeSegmentId);

  const seedValue = await readVoxel(cube, shape.seed, ctx.sourceMagIndex);
  if (seedValue === ctx.activeSegmentId) {
    // Nothing to do: the region already carries the target value, and treating
    // it as a fill would traverse it only to write what is already there.
    return out.build();
  }

  const queue: Vector3[] = [shape.seed];
  let visited = 0;

  // A cache of the bucket most recently read, so a run of neighbours inside one
  // bucket does not re-enter the async path.
  let cachedAddress: BucketAddress | null = null;
  let cachedData: BigUint64Array | null = null;

  while (queue.length > 0) {
    signal?.throwIfAborted();
    const voxel = queue.pop() as Vector3;

    if (!isInBoundingBox(voxel, shape.bounds)) continue;
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

    for (const neighbour of neighbours(voxel, shape.is3D)) queue.push(neighbour);
  }

  return out.build();
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

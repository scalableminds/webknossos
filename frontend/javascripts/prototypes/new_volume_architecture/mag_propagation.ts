import {
  type EditContext,
  FINEST_MAG_INDEX,
  floorDiv,
  type Mag,
  type MagIndex,
  type MagList,
  originVoxelOf,
  type Vector3,
  voxelOffsetOf,
} from "./types";
import { type VoxelWriteSet, WriteSetBuilder } from "./write_set";

/**
 * Source mag → every other mag, walking the pyramid outward one adjacent level
 * at a time. Pure: reads no voxel data and triggers no bucket loads.
 *
 * Upsample (toward the finest mag) is a replication, one-to-many, no conflicts
 * possible. Downsample (toward the coarsest) is written-value-wins, many-to-one,
 * with background treated as an ordinary value.
 *
 * Cascading rather than deriving every mag from the finest one gives identical
 * results — the writes are single-valued and block replication composes — but
 * each step works from the nearest, smallest write set instead of the largest.
 */
export function propagate(
  sourceWrites: VoxelWriteSet,
  ctx: EditContext,
  mags: MagList,
): Map<MagIndex, VoxelWriteSet> {
  const result = new Map<MagIndex, VoxelWriteSet>();
  result.set(ctx.sourceMagIndex, sourceWrites);

  // Step A: upsample toward the finest mag.
  let writes = sourceWrites;
  for (let index = ctx.sourceMagIndex; index > FINEST_MAG_INDEX; index--) {
    const factor = mags.factorBetween(index - 1, index);
    writes = upsampleOneLevel(writes, factor, index - 1, ctx.activeSegmentId);
    result.set(index - 1, writes);
  }

  // Step B: downsample toward the coarsest mag.
  writes = sourceWrites;
  for (let index = ctx.sourceMagIndex; index < mags.length - 1; index++) {
    const factor = mags.factorBetween(index, index + 1);
    writes = downsampleOneLevel(writes, factor, index + 1, ctx.activeSegmentId);
    result.set(index + 1, writes);
  }

  return result;
}

/**
 * One level finer. A voxel `q` covers the block `[q*f, (q+1)*f)` at the target
 * level, so a run of `length` voxels becomes a solid block emitted as one run
 * of `length * f[0]` per (dy, dz) — not `length * f[0]*f[1]*f[2]` writes.
 */
export function upsampleOneLevel(
  writes: VoxelWriteSet,
  factor: Mag,
  targetMagIndex: MagIndex,
  value: bigint,
): VoxelWriteSet {
  const out = new WriteSetBuilder(targetMagIndex, value);

  for (const entry of writes.values()) {
    const origin = originVoxelOf(entry.address);
    for (const run of entry.writes.mask.runs()) {
      const [x, y, z] = voxelOffsetOf(run.start);
      const base: Vector3 = [
        (origin[0] + x) * factor[0],
        (origin[1] + y) * factor[1],
        (origin[2] + z) * factor[2],
      ];
      for (let dz = 0; dz < factor[2]; dz++) {
        for (let dy = 0; dy < factor[1]; dy++) {
          out.markRun([base[0], base[1] + dy, base[2] + dz], run.length * factor[0]);
        }
      }
    }
  }
  return out.build();
}

/**
 * One level coarser. A voxel `p` belongs to `floor(p / f)`. Many voxels collapse
 * onto one; written-value-wins decides, and since a transaction is single-valued
 * there is nothing to decide between.
 */
export function downsampleOneLevel(
  writes: VoxelWriteSet,
  factor: Mag,
  targetMagIndex: MagIndex,
  value: bigint,
): VoxelWriteSet {
  const out = new WriteSetBuilder(targetMagIndex, value);

  for (const entry of writes.values()) {
    const origin = originVoxelOf(entry.address);
    for (const run of entry.writes.mask.runs()) {
      const [x, y, z] = voxelOffsetOf(run.start);
      const globalY = origin[1] + y;
      const globalZ = origin[2] + z;
      const startX = origin[0] + x;
      const coarseY = floorDiv(globalY, factor[1]);
      const coarseZ = floorDiv(globalZ, factor[2]);
      const coarseX0 = floorDiv(startX, factor[0]);
      const coarseX1 = floorDiv(startX + run.length - 1, factor[0]);
      out.markRun([coarseX0, coarseY, coarseZ], coarseX1 - coarseX0 + 1);
    }
  }
  return out.build();
}

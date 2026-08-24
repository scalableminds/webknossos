/**
 * Spike implementation of the volume-annotation architecture described in
 * `design/volume_annotation_architecture.md`.
 *
 * Standalone on purpose: it imports nothing from `viewer/`, is wired into no
 * part of the running app, and is exercised only by unit tests. Scope is the
 * MVP — brush and flood fill, no proofreading, no interpolation, no additional
 * coordinates, no save/backend transport beyond an in-memory fake.
 */

export { type BackendLike, type BucketState, FakeBackend, WorkingDataCube } from "./cube";
export {
  applyRun,
  type BucketDiff,
  bucketDiffsOf,
  countDiffVoxels,
  decodeBucketDiff,
  encodeBucketDiff,
  type TransactionDiff,
  type TransactionId,
  toRuns,
  type VoxelRun,
} from "./diff";
export type {
  AnalyticShape,
  DataDependentShape,
  EditIntent,
  MaskShape,
  RasterizableShape,
} from "./intents";
export { BucketJournal, type BucketLog, type BucketLogEntry } from "./journal";
export { downsampleOneLevel, propagate, upsampleOneLevel } from "./mag_propagation";
export { rasterize } from "./rasterizer";
export { resolve, resolveFloodFill } from "./resolver";
export { VolumeEditingSession } from "./session";
export { type BucketWriter, VolumeTransaction } from "./transaction";
export {
  type BoundingBox,
  BUCKET_VOXEL_COUNT,
  BUCKET_WIDTH,
  type BucketAddress,
  type BucketKey,
  bucketAddressOfVoxel,
  bucketKey,
  type EditContext,
  FINEST_MAG_INDEX,
  type Mag,
  type MagIndex,
  MagList,
  type OverwriteMode,
  originVoxelOf,
  type SegmentId,
  type Vector3,
  type VoxelIndex,
  voxelIndexOf,
  voxelOffsetInBucket,
  voxelOffsetOf,
} from "./types";
export { VoxelMask } from "./voxel_mask";
export {
  type BucketWrites,
  countVoxels,
  type VoxelWriteSet,
  WriteSetBuilder,
} from "./write_set";

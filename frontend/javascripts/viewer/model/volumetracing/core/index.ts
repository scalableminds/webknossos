/**
 * The volume-annotation core described in
 * `design/volume_annotation_architecture.md` (§12 for what is built so far).
 *
 * Framework-free by construction: no store, no sagas, no React, and only two
 * imports from `viewer/` (see types.ts). Everything that bridges to the running
 * app lives in `../integration`; everything that exists only to exercise this
 * code lives in `../not_yet_integrated`.
 */

export { BucketVoxelMask } from "./bucket_voxel_mask";
export {
  type BucketWrite,
  type BucketWriteMap,
  BucketWriteMapBuilder,
  countVoxels,
} from "./bucket_write_map";
export type { BackendLike, BucketState, LoadingVoxelCube, TransactionCube } from "./cube";
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
export { downsampleOneLevel, propagate, upsampleOneLevel } from "./mag_propagation";
export { rasterize } from "./rasterizer";
export { resolve, resolveFloodFill } from "./resolver";
export { type BucketWriter, VolumeTransaction } from "./transaction";
export {
  type AdditionalCoordinate,
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
  type SegmentBucketData,
  type SegmentId,
  type StoredSegmentId,
  type Vector3,
  type VoxelIndex,
  voxelIndexOf,
  voxelOffsetInBucket,
  voxelOffsetOf,
} from "./types";

/**
 * The parts of a tool driver's input and output that do not depend on which
 * tool it is. Shared by brush_driver.ts and flood_fill_driver.ts so the two
 * stay in step.
 */

import type { AdditionalCoordinate } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { BucketDiff } from "../core/bucket_diff";
import type { MagIndex, SegmentId } from "../core/volume_annotation_types";

/**
 * How an edit is saved, which depends on the collaboration mode:
 * - "fullBuckets": the touched buckets go through the push queue and are saved
 *   whole (updateBucket), with undo snapshots.
 * - "partialUpdates" (live collaboration): the caller sends the committed bucket
 *   diffs as updateBucketPartial actions. Buckets are neither pushed nor
 *   snapshotted for undo, because undo is unavailable in that mode.
 */
export type SaveMode = "fullBuckets" | "partialUpdates";

/** What every driver needs in order to address the layer it writes into. */
export interface DriverOptions {
  cube: DataCube;
  magIndex: MagIndex;
  segmentId: SegmentId;
  additionalCoordinates: AdditionalCoordinate[] | null;
  saveMode: SaveMode;
}

/** What every driver reports once its transaction is committed. */
export interface DriverResult {
  voxels: number;
  buckets: number;
  /** The mag indices the commit touched, ascending. */
  mags: number[];
  durationMs: number;
  /**
   * The committed per-bucket diffs, for the caller to send as partial bucket
   * updates when the edit is saved that way (see SaveMode).
   */
  bucketDiffs: BucketDiff[];
}

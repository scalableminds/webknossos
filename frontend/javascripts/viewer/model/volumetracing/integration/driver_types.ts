/**
 * The parts of a tool driver's input and output that do not depend on which
 * tool it is. Shared by brush_driver.ts and flood_fill_driver.ts so the two
 * stay in step.
 */

import type { AdditionalCoordinate } from "viewer/constants";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type { MagIndex, SegmentId, Vector3 } from "../core/types";

/** What every driver needs in order to address the layer it writes into. */
export interface DriverOptions {
  cube: DataCube;
  denseMags: Vector3[];
  magIndex: MagIndex;
  segmentId: SegmentId;
  additionalCoordinates: AdditionalCoordinate[] | null;
}

/** What every driver reports once its transaction is committed. */
export interface DriverResult {
  voxels: number;
  buckets: number;
  /** The mag indices the commit touched, ascending. */
  mags: number[];
  durationMs: number;
}

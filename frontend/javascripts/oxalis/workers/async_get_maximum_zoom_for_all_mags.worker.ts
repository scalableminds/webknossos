import type { Matrix4x4 } from "mjs";
import type { OrthoViewRects, Vector3, ViewMode } from "oxalis/constants";
import { _getMaximumZoomForAllMags } from "oxalis/model/accessors/flycam_accessor";
import type { LoadingStrategy } from "oxalis/store";
import { expose } from "./comlink_wrapper";

function asyncGetMaximumZoomForAllMags(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  voxelSizeFactor: Vector3,
  mags: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  layerMatrix: Matrix4x4,
  flycamMatrix: Matrix4x4,
) {
  return _getMaximumZoomForAllMags(
    viewMode,
    loadingStrategy,
    voxelSizeFactor,
    mags,
    viewportRects,
    maximumCapacity,
    layerMatrix,
    flycamMatrix,
  );
}

export default expose(asyncGetMaximumZoomForAllMags);

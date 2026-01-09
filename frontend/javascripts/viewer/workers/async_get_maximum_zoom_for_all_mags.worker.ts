import * as Comlink from "comlink";
import type { Matrix4x4 } from "mjs";

// Imports in WebWorkers need to be relative
import "./init_comlink";
import type { OrthoViewRects, Vector3, ViewMode } from "../../viewer/constants";
import { _getMaximumZoomForAllMags } from "../../viewer/model/accessors/flycam_accessor";
import type { LoadingStrategy } from "../../viewer/store";

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

export default Comlink.expose(asyncGetMaximumZoomForAllMags);

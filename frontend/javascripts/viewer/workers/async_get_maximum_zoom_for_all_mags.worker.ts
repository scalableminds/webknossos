import type { Matrix4x4 } from "mjs";
import type { OrthoViewRects, Vector3, ViewMode } from "viewer/constants";
import { _getMaximumZoomForAllMags } from "viewer/model/accessors/flycam_accessor";
import type { LoadingStrategy } from "viewer/store";
import { expose } from "./comlink_core";

async function asyncGetMaximumZoomForAllMags(
  viewMode: ViewMode,
  loadingStrategy: LoadingStrategy,
  voxelSizeFactor: Vector3,
  mags: Array<Vector3>,
  viewportRects: OrthoViewRects,
  maximumCapacity: number,
  layerMatrix: Matrix4x4,
  flycamMatrix: Matrix4x4,
  obliquePickerStrategy?: "scanLines" | "floodFill" | "wasm" | "floodFillWasm",
  prefetchAlongViewAxis?: boolean,
) {
  // Dev-only: logs the exact parameters of this call as JSON, so they can be pasted
  // elsewhere (e.g. into a benchmark reproducing this specific real-world scenario).
  // console.log(
  //   "getMaximumZoomForAllMags params:",
  //   JSON.stringify({
  //     viewMode,
  //     loadingStrategy,
  //     voxelSizeFactor,
  //     mags,
  //     viewportRects,
  //     maximumCapacity,
  //     layerMatrix,
  //     flycamMatrix,
  //     obliquePickerStrategy,
  //     prefetchAlongViewAxis,
  //   }),
  // );
  console.time("getMaximumZoomForAllMags");
  const retval = await _getMaximumZoomForAllMags(
    viewMode,
    loadingStrategy,
    voxelSizeFactor,
    mags,
    viewportRects,
    maximumCapacity,
    layerMatrix,
    flycamMatrix,
    obliquePickerStrategy,
    prefetchAlongViewAxis,
  );
  console.timeEnd("getMaximumZoomForAllMags");
  return retval;
}

export default expose(asyncGetMaximumZoomForAllMags);

import cwise from "cwise";
import distanceTransform from "distance-transform";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import ndarray from "ndarray";
import api from "oxalis/api/internal_api";
import { AnnotationToolEnum, ContourModeEnum } from "oxalis/constants";
import Model from "oxalis/model";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { getFlooredPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import DataLayer from "oxalis/model/data_layer";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import VolumeLayer, { VoxelBuffer2D } from "oxalis/model/volumetracing/volumelayer";
import { call } from "typed-redux-saga";
import { createVolumeLayer, getBoundingBoxForViewport, labelWithVoxelBuffer2D } from "./helpers";

const isEqual = cwise({
  args: ["array", "scalar"],
  body: function body(a: number, b: number) {
    a = a === b ? 1 : 0;
  },
});

const mul = cwise({
  args: ["array", "scalar"],
  body: function body(a: number, b: number) {
    a = a * b;
  },
});

const avg = cwise({
  args: ["array", "array"],
  body: function body(a: number, b: number) {
    a = (a + b) / 2;
  },
});

const absMax = cwise({
  args: ["array", "array"],
  body: function body(a: number, b: number) {
    a = Math.abs(a) > Math.abs(b) ? a : b;
  },
});

const assign = cwise({
  args: ["array", "array"],
  body: function body(a: number, b: number) {
    a = b;
  },
});

function copy(Constructor: Float32ArrayConstructor, arr: ndarray.NdArray): ndarray.NdArray {
  const newArr = ndarray(new Constructor(arr.size), arr.shape, arr.stride);
  assign(newArr, arr);
  return newArr;
}

function signedDist(arr: ndarray.NdArray) {
  // print("arr", arr, 0);
  arr = copy(Float32Array, arr);
  const negatedCopy = copy(Float32Array, arr);
  // print("copy", negatedCopy, 0);

  isEqual(negatedCopy, 0);
  // print("negatedCopy", negatedCopy, 0);
  distanceTransform(negatedCopy);
  // print("negatedCopy transformed", negatedCopy, 0);
  mul(negatedCopy, -1);
  // print("negatedCopy * -1", negatedCopy, 0);

  distanceTransform(arr);
  // print("arr", arr, 0);

  absMax(arr, negatedCopy);

  // print("signed", arr, 0);
  return arr;
}

// window.testNd = () => {
//   const array = ndarray(new Uint8Array(25 * 2), [5, 5, 2], [1, 5, 25]);
//   const array2 = ndarray(new Uint8Array(25 * 2), [5, 5, 2], [1, 5, 25]);
//   // const subview = arr.lo(0, 1);
//   const subview = array;

//   let counter = 0;
//   for (let z = 0; z < subview.shape[2]; ++z) {
//     for (let y = 2; y < subview.shape[1]; ++y) {
//       for (let x = 2; x < subview.shape[0]; ++x) {
//         subview.set(x, y, z, 1);
//       }
//     }
//   }

//   console.log("array.get(4, 0, 0)", array.get(4, 0, 0));

//   print("", subview, 0);
//   const subviewDists = signedDist(subview);
//   print("", subviewDists, 0);
// };

// function print(pref: string, arr: ndarray.NdArray, z: number) {
//   console.log(pref);
//   if (arr.data.length > 100) {
//     return;
//   }
//   const lines = [];
//   for (var y = 0; y < arr.shape[1]; ++y) {
//     const chars = [];
//     for (var x = 0; x < arr.shape[0]; ++x) {
//       chars.push(arr.get(x, y, z));
//     }
//     lines.push(chars.join(" "));
//   }
//   console.log(lines.join("\n"));
// }
// testNd();

export default function* interpolateSegmentationLayer(layer: VolumeLayer): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

  const isVolumeInterpolationEnabled = yield* select(
    (state) => state.userConfiguration.isVolumeInterpolationEnabled,
  );
  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);

  if (!isVolumeInterpolationEnabled) {
    return;
  }

  if (activeViewport !== "PLANE_XY") {
    // Interpolation is only done in XY
    return;
  }

  // Disable copy-segmentation for the same zoom steps where the trace tool is forbidden, too,
  // to avoid large performance lags.
  const isResolutionTooLow = yield* select((state) =>
    isVolumeAnnotationDisallowedForZoom(AnnotationToolEnum.TRACE, state),
  );

  if (isResolutionTooLow) {
    Toast.warning(
      'The "interpolate segmentation"-feature is not supported at this zoom level. Please zoom in further.',
    );
    return;
  }

  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const segmentationLayer: DataLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );
  const requestedZoomStep = yield* select((state) => getRequestLogZoomStep(state));
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  // const dimensionIndices = Dimensions.getIndices(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const activeCellId = volumeTracing.activeCellId;

  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  // let direction = 1;
  // const useDynamicSpaceDirection = yield* select(
  //   (state) => state.userConfiguration.dynamicSpaceDirection,
  // );

  // if (useDynamicSpaceDirection) {
  //   const spaceDirectionOrtho = yield* select((state) => state.flycam.spaceDirectionOrtho);
  //   direction = spaceDirectionOrtho[thirdDim];
  // }

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }

  // Annotate only every n-th slice while the remaining ones are interpolated automatically.
  const INTERPOLATION_DEPTH = 2;

  const drawnBoundingBox = layer.getLabeledBoundingBox();
  if (drawnBoundingBox == null) {
    return;
  }
  console.time("Interpolate segmentation");
  const xyPadding = V3.scale3(drawnBoundingBox.getSize(), [1, 1, 0]);
  const viewportBoxMag1 = yield* call(getBoundingBoxForViewport, position, activeViewport);
  const relevantBoxMag1 = drawnBoundingBox
    // Increase the drawn region by a factor of 2 (use half the size as a padding on each size)
    .paddedWithMargins(V3.scale(xyPadding, 0.5))
    // Intersect with the viewport
    .intersectedWith(viewportBoxMag1)
    // Also consider the n previous slices
    .paddedWithMargins([0, 0, INTERPOLATION_DEPTH], [0, 0, 0])
    .rounded();

  console.time("Get Data");
  const inputData = yield* call(
    [api.data, api.data.getDataFor2DBoundingBox],
    volumeTracingLayer.name,
    relevantBoxMag1,
    requestedZoomStep,
  );

  console.timeEnd("Get Data");

  console.time("Iterate over data");

  const size = V3.sub(relevantBoxMag1.max, relevantBoxMag1.min);
  const stride = [1, size[0], size[0] * size[1]];
  const inputNd = ndarray(inputData, size, stride);

  const interpolationVoxelBuffers: Record<number, VoxelBuffer2D> = {};
  for (let targetOffsetZ = 1; targetOffsetZ < INTERPOLATION_DEPTH; targetOffsetZ++) {
    const interpolationLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      "PLANE_XY",
      labeledResolution,
      relevantBoxMag1.min[2] + targetOffsetZ,
    );
    interpolationVoxelBuffers[targetOffsetZ] = interpolationLayer.createVoxelBuffer2D(
      interpolationLayer.globalCoordToMag2D(V3.add(relevantBoxMag1.min, [0, 0, targetOffsetZ])),
      size[0],
      size[1],
    );
  }

  const firstSlice = inputNd.pick(null, null, 0);
  const lastSlice = inputNd.pick(null, null, INTERPOLATION_DEPTH);

  isEqual(firstSlice, activeCellId);
  isEqual(lastSlice, activeCellId);

  const firstSliceDists = signedDist(firstSlice);
  const lastSliceDists = signedDist(lastSlice);
  avg(firstSliceDists, lastSliceDists);

  const avgDistances = firstSliceDists;

  let drawnVoxels = 0;
  for (let x = 0; x < size[0]; x++) {
    for (let y = 0; y < size[1]; y++) {
      if (avgDistances.get(x, y) < 0) {
        for (let targetOffsetZ = 1; targetOffsetZ < INTERPOLATION_DEPTH; targetOffsetZ++) {
          const voxelBuffer2D = interpolationVoxelBuffers[targetOffsetZ];
          voxelBuffer2D.setValue(x, y, 1);
          drawnVoxels++;
        }
      }
    }
  }
  console.log("drawnVoxels", drawnVoxels);
  console.timeEnd("Iterate over data");

  console.time("Apply VoxelBuffer2D");
  for (const voxelBuffer of Object.values(interpolationVoxelBuffers)) {
    yield* call(
      labelWithVoxelBuffer2D,
      voxelBuffer,
      ContourModeEnum.DRAW,
      overwriteMode,
      labeledZoomStep,
    );
  }
  console.timeEnd("Apply VoxelBuffer2D");

  console.timeEnd("Interpolate segmentation");
  console.log("");
}

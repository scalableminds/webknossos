import cwise from "cwise";
import distanceTransform from "distance-transform";
import { V2, V3 } from "libs/mjs";
import Toast from "libs/toast";
import ndarray from "ndarray";
import api from "oxalis/api/internal_api";
import {
  AnnotationTool,
  ContourModeEnum,
  ToolsWithInterpolationCapabilities,
} from "oxalis/constants";
import Model from "oxalis/model";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { getFlooredPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import DataLayer from "oxalis/model/data_layer";
import Dimensions from "oxalis/model/dimensions";
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

/*
 * Computes a signed distance transform for an input nd array.
 */
function signedDist(arr: ndarray.NdArray) {
  // Copy the input twice to avoid mutating it
  arr = copy(Float32Array, arr);
  const negatedArr = copy(Float32Array, arr);

  // Normal distance transform for arr
  distanceTransform(arr);

  // Invert negatedArr (1 to 0 and 0 to 1)
  isEqual(negatedArr, 0);
  distanceTransform(negatedArr);
  // Negate the distances
  mul(negatedArr, -1);

  // Create a combined array which contains positive
  // distances for voxels outside of the labeled area
  // and negative distances for voxels inside the labeled
  // area.
  absMax(arr, negatedArr);
  return arr;
}

export default function* maybeInterpolateSegmentationLayer(
  layer: VolumeLayer,
  isDrawing: boolean,
  activeTool: AnnotationTool,
): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);

  if (!ToolsWithInterpolationCapabilities.includes(activeTool) || !isDrawing) {
    return;
  }

  const isVolumeInterpolationEnabled = yield* select(
    (state) => state.userConfiguration.isVolumeInterpolationEnabled,
  );

  if (!isVolumeInterpolationEnabled) {
    return;
  }

  if (activeViewport !== "PLANE_XY") {
    // Interpolation is only done/supported in XY
    return;
  }

  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);

  // Disable copy-segmentation for the same zoom steps where the brush/trace tool is forbidden, too.
  const isResolutionTooLow = yield* select((state) =>
    isVolumeAnnotationDisallowedForZoom(activeTool, state),
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
  const thirdDim = Dimensions.thirdDimensionForPlane(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const activeCellId = volumeTracing.activeCellId;

  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  const spaceDirectionOrtho = yield* select((state) => state.flycam.spaceDirectionOrtho);
  const directionFactor = spaceDirectionOrtho[thirdDim];

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }

  // Annotate only every n-th slice while the remaining ones are interpolated automatically.
  const INTERPOLATION_DEPTH = 2;

  const drawnBoundingBoxMag1 = layer.getLabeledBoundingBox();
  if (drawnBoundingBoxMag1 == null) {
    return;
  }
  console.time("Interpolate segmentation");
  const xySize = V3.scale3(drawnBoundingBoxMag1.getSize(), [1, 1, 0]);
  const viewportBoxMag1 = yield* call(getBoundingBoxForViewport, position, activeViewport);
  const relevantBoxMag1 = drawnBoundingBoxMag1
    // Increase the drawn region by a factor of 2 (use half the size as a padding on each size)
    .paddedWithMargins(V3.scale(xySize, 0.5))
    // Intersect with the viewport
    .intersectedWith(viewportBoxMag1)
    // Also consider the n previous slices
    .paddedWithSignedMargins([
      0,
      0,
      directionFactor * INTERPOLATION_DEPTH * labeledResolution[thirdDim],
    ])
    .rounded();
  const relevantBoxCurrentMag = relevantBoxMag1.fromMag1ToMag(labeledResolution);

  console.time("Get Data");
  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    volumeTracingLayer.name,
    relevantBoxMag1,
    requestedZoomStep,
  );

  console.timeEnd("Get Data");

  console.time("Iterate over data");

  const size = relevantBoxCurrentMag.getSize();
  console.log("relevantBoxCurrentMag", relevantBoxCurrentMag);
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
      V2.floor(
        interpolationLayer.globalCoordToMag2DFloat(
          V3.add(relevantBoxMag1.min, [0, 0, targetOffsetZ]),
        ),
      ),
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

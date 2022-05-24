import cwise from "cwise";
import distanceTransform from "distance-transform";
import { V2, V3 } from "libs/mjs";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import ndarray, { NdArray } from "ndarray";
import api from "oxalis/api/internal_api";
import {
  ContourModeEnum,
  OrthoViews,
  ToolsWithInterpolationCapabilities,
  Vector3,
} from "oxalis/constants";
import Model from "oxalis/model";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { getFlooredPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getLabelActionFromPreviousSlice,
  getLastLabelAction,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import Dimensions from "oxalis/model/dimensions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { VoxelBuffer2D } from "oxalis/model/volumetracing/volumelayer";
import { OxalisState } from "oxalis/store";
import { call } from "typed-redux-saga";
import { createVolumeLayer, getBoundingBoxForViewport, labelWithVoxelBuffer2D } from "./helpers";

export const MAXIMUM_INTERPOLATION_DEPTH = 8;

export function getInterpolationInfo(state: OxalisState) {
  const isAllowed = state.tracing.restrictions.volumeInterpolationAllowed;
  const volumeTracing = getActiveSegmentationTracing(state);
  const mostRecentLabelAction = volumeTracing != null ? getLastLabelAction(volumeTracing) : null;

  const activeViewport = mostRecentLabelAction?.plane || OrthoViews.PLANE_XY;

  const thirdDim = Dimensions.thirdDimensionForPlane(activeViewport);
  const previousCentroid = !volumeTracing
    ? null
    : getLabelActionFromPreviousSlice(state, volumeTracing, thirdDim)?.centroid;

  let disabledExplanation = null;
  let tooltipAddendum = "";

  const position = getFlooredPosition(state.flycam);

  if (previousCentroid != null) {
    const interpolationDepth = Math.abs(V3.floor(V3.sub(previousCentroid, position))[thirdDim]);

    if (activeViewport === OrthoViews.TDView) {
      disabledExplanation = "Not available for the 3D viewport";
    } else if (interpolationDepth > MAXIMUM_INTERPOLATION_DEPTH) {
      disabledExplanation = `Not available since last labeled slice is too many slices away (distance > ${MAXIMUM_INTERPOLATION_DEPTH})`;
    } else if (interpolationDepth < 2) {
      disabledExplanation =
        "Not available since last labeled slice should be at least 2 slices away";
    } else {
      tooltipAddendum = `Labels ${interpolationDepth - 1} ${pluralize(
        "slice",
        interpolationDepth - 1,
      )} along ${Dimensions.dimensionNameForIndex(thirdDim)}`;
    }
  } else {
    disabledExplanation =
      "Not available because all recent label actions were performed on the current slice.";
  }

  const isPossible = disabledExplanation != null;
  tooltipAddendum = disabledExplanation || tooltipAddendum;

  const tooltipTitle = isAllowed
    ? `Interpolate current segment between last labeled and current slice (V) – ${tooltipAddendum}`
    : "Volume Interpolation was disabled for this annotation.";
  const isDisabled = !(isAllowed && isPossible);
  return { tooltipTitle, disabledExplanation, isDisabled, activeViewport, previousCentroid };
}

const isEqual = cwise({
  args: ["array", "scalar"],
  body: function body(a: number, b: number) {
    a = a === b ? 1 : 0;
  },
});

const isNonZero = cwise({
  args: ["array"],
  // The following function is parsed by cwise which is why
  // the shorthand syntax is not supported.
  // eslint-disable-next-line object-shorthand
  body: function (a) {
    if (a > 0) {
      return true;
    }
    return false;
  },
  // The following function is parsed by cwise which is why
  // the shorthand syntax is not supported.
  // eslint-disable-next-line object-shorthand
  post: function () {
    return false;
  },
}) as (arr: NdArray) => boolean;

const mul = cwise({
  args: ["array", "scalar"],
  body: function body(a: number, b: number) {
    a = a * b;
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
  const { shape } = arr;
  let stride;

  if (arr.shape.length === 3) {
    stride = [1, shape[0], shape[0] * shape[1]];
  } else if (arr.shape.length === 2) {
    stride = [1, shape[0]];
  } else if (arr.shape.length === 1) {
    stride = [1];
  } else {
    throw new Error("Copy was not implemented for this dimensionality.");
  }

  const newArr = ndarray(new Constructor(arr.size), arr.shape, stride);
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

export default function* maybeInterpolateSegmentationLayer(): Saga<void> {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (!ToolsWithInterpolationCapabilities.includes(activeTool)) {
    return;
  }

  const isVolumeInterpolationAllowed = yield* select(
    (state) => state.tracing.restrictions.volumeInterpolationAllowed,
  );

  if (!isVolumeInterpolationAllowed) {
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

  const { activeViewport, previousCentroid, disabledExplanation } = yield* select(
    getInterpolationInfo,
  );

  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  const segmentationLayer = yield* call(
    [Model, Model.getSegmentationTracingLayer],
    volumeTracing.tracingId,
  );

  const requestedZoomStep = yield* select((state) => getRequestLogZoomStep(state));
  const resolutionInfo = yield* call(getResolutionInfo, segmentationLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const activeCellId = volumeTracing.activeCellId;

  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);
  const spaceDirectionOrtho = yield* select((state) => state.flycam.spaceDirectionOrtho);
  const directionFactor = spaceDirectionOrtho[thirdDim];

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }

  if (disabledExplanation != null || previousCentroid == null) {
    // A disabledExplanation should always exist if previousCentroid is null,
    // but this logic is inferred by TS.
    if (disabledExplanation) {
      Toast.warning(`Could not interpolate segment: ${disabledExplanation}`);
    }
    return;
  }
  const interpolationDepth = Math.abs(V3.floor(V3.sub(previousCentroid, position))[thirdDim]);

  const viewportBoxMag1 = yield* call(getBoundingBoxForViewport, position, activeViewport);

  const transpose = (vector: Vector3) => Dimensions.transDim(vector, activeViewport);

  const relevantBoxMag1 = viewportBoxMag1
    // Consider the n previous/next slices
    .paddedWithSignedMargins(
      transpose([0, 0, -directionFactor * interpolationDepth * labeledResolution[thirdDim]]),
    )
    .alignWithMag(labeledResolution, true)
    .rounded();
  const relevantBoxCurrentMag = relevantBoxMag1.fromMag1ToMag(labeledResolution);

  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    volumeTracingLayer.name,
    relevantBoxMag1,
    labeledZoomStep,
  );

  const size = relevantBoxCurrentMag.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  const inputNd = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  const interpolationVoxelBuffers: Record<number, VoxelBuffer2D> = {};
  for (let targetOffsetW = 1; targetOffsetW < interpolationDepth; targetOffsetW++) {
    const interpolationLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      activeViewport,
      labeledResolution,
      relevantBoxMag1.min[thirdDim] + labeledResolution[thirdDim] * targetOffsetW,
    );
    interpolationVoxelBuffers[targetOffsetW] = interpolationLayer.createVoxelBuffer2D(
      V2.floor(
        interpolationLayer.globalCoordToMag2DFloat(
          V3.add(relevantBoxMag1.min, transpose([0, 0, targetOffsetW])),
        ),
      ),
      size[firstDim],
      size[secondDim],
    );
  }

  const firstSlice = inputNd.pick(null, null, 0);
  const lastSlice = inputNd.pick(null, null, interpolationDepth);

  isEqual(firstSlice, activeCellId);
  isEqual(lastSlice, activeCellId);

  if (!isNonZero(firstSlice) || !isNonZero(lastSlice)) {
    Toast.warning(
      `Could not interpolate segment, because id ${activeCellId} was not found in source/target slice.`,
    );
    return;
  }

  const firstSliceDists = signedDist(firstSlice);
  const lastSliceDists = signedDist(lastSlice);

  for (let u = 0; u < size[firstDim]; u++) {
    for (let v = 0; v < size[secondDim]; v++) {
      const firstVal = firstSliceDists.get(u, v);
      const lastVal = lastSliceDists.get(u, v);
      for (let targetOffsetW = 1; targetOffsetW < interpolationDepth; targetOffsetW++) {
        const k = targetOffsetW / interpolationDepth;
        const weightedAverage = firstVal * (1 - k) + lastVal * k;
        if (weightedAverage < 0) {
          const voxelBuffer2D = interpolationVoxelBuffers[targetOffsetW];
          voxelBuffer2D.setValue(u, v, 1);
        }
      }
    }
  }

  for (const voxelBuffer of Object.values(interpolationVoxelBuffers)) {
    yield* call(
      labelWithVoxelBuffer2D,
      voxelBuffer,
      ContourModeEnum.DRAW,
      overwriteMode,
      labeledZoomStep,
      activeViewport,
    );
  }
}

import cwise from "cwise";
import distanceTransform from "distance-transform";
import { V2, V3 } from "libs/mjs";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import ndarray, { type NdArray } from "ndarray";
import {
  ContourModeEnum,
  InterpolationModeEnum,
  OrthoViews,
  type TypedArrayWithoutBigInt,
  type Vector3,
} from "oxalis/constants";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";
import { getMagInfo } from "oxalis/model/accessors/dataset_accessor";
import {
  getActiveMagIndexForLayer,
  getFlooredPosition,
} from "oxalis/model/accessors/flycam_accessor";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getLabelActionFromPreviousSlice,
  getLastLabelAction,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  finishAnnotationStrokeAction,
  registerLabelPointAction,
} from "oxalis/model/actions/volumetracing_actions";
import Dimensions from "oxalis/model/dimensions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import type { VoxelBuffer2D } from "oxalis/model/volumetracing/volumelayer";
import { Model, api } from "oxalis/singletons";
import type { OxalisState } from "oxalis/store";
import { call, put } from "typed-redux-saga";
import { requestBucketModificationInVolumeTracing } from "../saga_helpers";
import { createVolumeLayer, getBoundingBoxForViewport, labelWithVoxelBuffer2D } from "./helpers";

/*
 * This saga is capable of doing segment interpolation between two slices.
 * Additionally, it also provides means to do a segment extrusion (in other words,
 * a segment is simply copied from one slice to n other slices).
 * Since the interpolation mechanism is a super set of the extrusion, this module
 * can do both operations and switches between them via the interpolationMode.
 * Beware of the following differences:
 * - for extrusion, the segment only has to be labeled on _one_ slice (for interpolation,
 *   two input slices are necessary)
 * - for extrusion, the active slice (active when triggering the operation) also has to be labeled
 *   (for interpolation, the active slice is assumed to already have the segment labeled)
 * - for extrusion, no distance transform is necessary (since a simple copy operation is done)
 */

export const MAXIMUM_INTERPOLATION_DEPTH = 100;

function _getInterpolationInfo(state: OxalisState, explanationPrefix: string) {
  const isAllowed = state.annotation.restrictions.volumeInterpolationAllowed;
  const onlyExtrude = state.userConfiguration.interpolationMode === InterpolationModeEnum.EXTRUDE;
  const volumeTracing = getActiveSegmentationTracing(state);
  let interpolationDepth = 0;
  let directionFactor = 1;
  if (!volumeTracing) {
    // Return dummy values, since the feature should be disabled, anyway
    return {
      tooltipTitle: "Volume Interpolation/Extrusion",
      disabledExplanation: "Only available when a volume annotation exists.",
      isDisabled: true,
      activeViewport: OrthoViews.PLANE_XY,
      previousCentroid: null,
      labeledMag: [1, 1, 1] as Vector3,
      labeledZoomStep: 0,
      interpolationDepth,
      directionFactor,
      onlyExtrude,
    };
  }
  const mostRecentLabelAction = getLastLabelAction(volumeTracing);

  const activeViewport = mostRecentLabelAction?.plane || OrthoViews.PLANE_XY;
  const thirdDim = Dimensions.thirdDimensionForPlane(activeViewport);

  const segmentationLayer = Model.getSegmentationTracingLayer(volumeTracing.tracingId);
  const requestedZoomStep = getActiveMagIndexForLayer(state, segmentationLayer.name);
  const magInfo = getMagInfo(segmentationLayer.mags);
  const labeledZoomStep = magInfo.getClosestExistingIndex(requestedZoomStep);
  const labeledMag = magInfo.getMagByIndexOrThrow(labeledZoomStep);

  const previousCentroid = getLabelActionFromPreviousSlice(
    state,
    volumeTracing,
    labeledMag,
    thirdDim,
  )?.centroid;

  let disabledExplanation = null;
  let tooltipAddendum = "";

  if (previousCentroid != null) {
    const position = getFlooredPosition(state.flycam);
    // Note that in coarser mags (e.g., 8-8-2), the comparison of the coordinates
    // is done while respecting how the coordinates are clipped due to that magnification.
    // For example, in mag 8-8-2, the z distance needs to be divided by two, since it is measured
    // in global coordinates.
    const adapt = (vec: Vector3) => V3.roundElementToMag(vec, labeledMag, thirdDim);
    const signedInterpolationDepth = Math.floor(
      V3.sub(adapt(position), adapt(previousCentroid))[thirdDim] / labeledMag[thirdDim],
    );
    directionFactor = Math.sign(signedInterpolationDepth);
    interpolationDepth = Math.abs(signedInterpolationDepth);

    if (interpolationDepth > MAXIMUM_INTERPOLATION_DEPTH) {
      disabledExplanation = `${explanationPrefix} last labeled slice is too many slices away (distance > ${MAXIMUM_INTERPOLATION_DEPTH}).`;
    } else if (interpolationDepth < 2 && !onlyExtrude) {
      disabledExplanation = `${explanationPrefix} last labeled slice should be at least 2 slices away.`;
    } else {
      const labelCount = onlyExtrude ? interpolationDepth : interpolationDepth - 1;
      tooltipAddendum = `Labels ${labelCount} ${pluralize(
        "slice",
        labelCount,
      )} along ${Dimensions.dimensionNameForIndex(thirdDim)}`;
    }
  } else {
    disabledExplanation = `${explanationPrefix} all recent label actions were performed on the current slice.`;
  }

  const isPossible = disabledExplanation == null;
  tooltipAddendum = disabledExplanation || tooltipAddendum;

  const tooltipMain = onlyExtrude
    ? "Extrude (copy) current segment from last labeled until current slice (V)"
    : "Interpolate current segment between last labeled and current slice (V)";
  const tooltipTitle = isAllowed
    ? `${tooltipMain} – ${tooltipAddendum}`
    : "Volume Interpolation/Extrusion was disabled for this annotation.";
  const isDisabled = !(isAllowed && isPossible);
  return {
    tooltipTitle,
    disabledExplanation,
    isDisabled,
    activeViewport,
    previousCentroid,
    labeledMag,
    labeledZoomStep,
    interpolationDepth,
    directionFactor,
    onlyExtrude,
  };
}

export const getInterpolationInfo = reuseInstanceOnEquality(_getInterpolationInfo);

const isEqual = cwise({
  args: ["array", "scalar"],
  body: function body(a: number, b: number) {
    a = a === b ? 1 : 0;
  },
});

const isEqualFromBigUint64: (
  output: NdArray<TypedArrayWithoutBigInt>,
  a: NdArray<BigUint64Array>,
  b: bigint,
) => void = cwise({
  args: ["array", "array", "scalar"],
  // biome-ignore lint/correctness/noUnusedVariables: output is needed for the assignment
  body: function body(output: number, a: bigint, b: bigint) {
    output = a === b ? 1 : 0;
  },
});

const isNonZero = cwise({
  args: ["array"],
  // The following function is parsed by cwise which is why
  // the shorthand syntax is not supported.
  // Also, cwise uses this function content to build
  // the target function. Adding a return here would not
  // yield the desired behavior for isNonZero.

  body: function (a) {
    if (a > 0) {
      return true;
    }
  },
  // The following function is parsed by cwise which is why
  // the shorthand syntax is not supported.

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
  // biome-ignore lint/correctness/noUnusedVariables: a is needed for the assignment
  body: function body(a: number, b: number) {
    a = b;
  },
});

export function copyNdArray(
  Constructor: Uint8ArrayConstructor | Float32ArrayConstructor,
  arr: ndarray.NdArray,
): ndarray.NdArray {
  const { shape } = arr;
  let stride: number[];

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
  arr = copyNdArray(Float32Array, arr) as NdArray<Float32Array>;
  const negatedArr = copyNdArray(Float32Array, arr) as NdArray<Float32Array>;

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
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (!activeTool.hasInterpolationCapabilities) {
    return;
  }

  const isVolumeInterpolationAllowed = yield* select(
    (state) => state.annotation.restrictions.volumeInterpolationAllowed,
  );

  if (!isVolumeInterpolationAllowed) {
    return;
  }

  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);

  // Disable copy-segmentation for the same zoom steps where the brush/trace tool is forbidden, too.
  const isMagTooLow = yield* select((state) =>
    isVolumeAnnotationDisallowedForZoom(activeTool, state),
  );

  if (isMagTooLow) {
    Toast.warning(
      'The "interpolate segmentation"-feature is not supported at this zoom level. Please zoom in further.',
    );
    return;
  }

  const {
    activeViewport,
    previousCentroid,
    disabledExplanation,
    labeledMag,
    labeledZoomStep,
    interpolationDepth,
    directionFactor,
    onlyExtrude,
  } = yield* select((state) =>
    getInterpolationInfo(state, "Could not interpolate segment because"),
  );

  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const position = yield* select((state) => getFlooredPosition(state.flycam));
  const activeCellId = volumeTracing.activeCellId;

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }

  if (disabledExplanation != null || previousCentroid == null) {
    // A disabledExplanation should always exist if previousCentroid is null,
    // but this logic is not inferred by TS.
    if (disabledExplanation) {
      Toast.warning(disabledExplanation);
    }
    return;
  }

  const viewportBoxMag1 = yield* call(getBoundingBoxForViewport, position, activeViewport);

  const transpose = (vector: Vector3) => Dimensions.transDim(vector, activeViewport);

  const relevantBoxMag1 = viewportBoxMag1
    // Consider the n previous/next slices
    .paddedWithSignedMargins(
      transpose([0, 0, -directionFactor * interpolationDepth * labeledMag[thirdDim]]),
    )
    .alignWithMag(labeledMag, "grow")
    .rounded();
  const relevantBoxCurrentMag = relevantBoxMag1.fromMag1ToMag(labeledMag);

  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    volumeTracingLayer.name,
    relevantBoxMag1,
    labeledZoomStep,
    additionalCoordinates,
  );

  const size = relevantBoxCurrentMag.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  const inputNd = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  const adaptedInterpolationRange = onlyExtrude
    ? // When extruding and...
      directionFactor > 0
      ? // ...tracing forwards, the latest (== current) slice also has to be labeled
        [1, interpolationDepth + 1]
      : // ...tracing backwards, the first (== current) slice also has to be labeled
        [0, interpolationDepth]
    : // When interpolating, only the slices between start and end slice have to be labeled
      [1, interpolationDepth];

  const interpolationVoxelBuffers: Record<number, VoxelBuffer2D> = {};
  for (
    let targetOffsetW = adaptedInterpolationRange[0];
    targetOffsetW < adaptedInterpolationRange[1];
    targetOffsetW++
  ) {
    const interpolationLayer = yield* call(
      createVolumeLayer,
      volumeTracing,
      activeViewport,
      labeledMag,
      relevantBoxMag1.min[thirdDim] + labeledMag[thirdDim] * targetOffsetW,
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

  // These two variables will be initialized with binary masks (representing whether
  // a voxel contains the active segment id).
  let firstSlice: NdArray<TypedArrayWithoutBigInt>;
  let lastSlice: NdArray<TypedArrayWithoutBigInt>;

  const isBigUint64 = inputNd.data instanceof BigUint64Array;
  if (isBigUint64) {
    // For BigUint64 arrays, we want to convert as early as possible to Float32, since
    // the cwise operations don't generalize across all members of TypedArray.
    // Float values are more than enough, because the interpolation process only
    // cares about voxel distances. Also, the actual IDs are discarded by creating a binary
    // mask as the very first step (see below).

    const firstSliceBigInt = inputNd.pick(null, null, 0);
    const lastSliceBigInt = inputNd.pick(null, null, interpolationDepth);

    // Prepare empty output arrays in Float32
    firstSlice = ndarray(new Float32Array(firstSliceBigInt.size), firstSliceBigInt.shape);
    lastSlice = ndarray(new Float32Array(lastSliceBigInt.size), lastSliceBigInt.shape);

    const activeCellIdBig = BigInt(activeCellId);
    // Calculate firstSlice = firstSliceBigInt[...] == activeCellId
    isEqualFromBigUint64(firstSlice, firstSliceBigInt as NdArray<BigUint64Array>, activeCellIdBig);
    // Calculate lastSlice = lastSliceBigInt[...] == activeCellId
    isEqualFromBigUint64(lastSlice, lastSliceBigInt as NdArray<BigUint64Array>, activeCellIdBig);
  } else {
    firstSlice = inputNd.pick(null, null, 0) as NdArray<TypedArrayWithoutBigInt>;
    lastSlice = inputNd.pick(null, null, interpolationDepth) as NdArray<TypedArrayWithoutBigInt>;

    // Calculate firstSlice = firstSlice[...] == activeCellId
    isEqual(firstSlice, activeCellId);
    // Calculate lastSlice = lastSlice[...] == activeCellId
    isEqual(lastSlice, activeCellId);
  }

  if (onlyExtrude) {
    if (directionFactor > 0) {
      lastSlice = firstSlice;
    } else {
      firstSlice = lastSlice;
    }
  }

  if (!isNonZero(firstSlice) || !isNonZero(lastSlice)) {
    Toast.warning(
      `Could not interpolate segment, because id ${activeCellId} was not found in source/target slice.`,
    );
    return;
  }
  // As the interpolation will be applied, the potentially existing mapping should be locked to ensure a consistent state.
  const isModificationAllowed = yield* call(
    requestBucketModificationInVolumeTracing,
    volumeTracing,
  );
  if (!isModificationAllowed) {
    return;
  }

  // In the extrusion case, we don't need any distance transforms. The binary
  // masks are enough to decide whether a voxel needs to be written.
  const firstSliceDists = onlyExtrude ? firstSlice : signedDist(firstSlice);
  const lastSliceDists = onlyExtrude ? lastSlice : signedDist(lastSlice);

  for (let u = 0; u < size[firstDim]; u++) {
    for (let v = 0; v < size[secondDim]; v++) {
      const firstVal = firstSliceDists.get(u, v);
      const lastVal = lastSliceDists.get(u, v);
      for (
        let targetOffsetW = adaptedInterpolationRange[0];
        targetOffsetW < adaptedInterpolationRange[1];
        targetOffsetW++
      ) {
        const k = targetOffsetW / interpolationDepth;
        const weightedAverage = firstVal * (1 - k) + lastVal * k;
        const shouldDraw = onlyExtrude ? weightedAverage > 0 : weightedAverage < 0;
        if (shouldDraw) {
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

  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));

  // Theoretically, the user might extrude (or interpolate, even though this is less likely) multiple
  // times (e.g., from slice 0 to 5, then from 5 to 10 etc) without labeling anything in between manually.
  // In that case, the interpolation/extrusion would always start from slice 0 which is unexpected and leads
  // to additional performance overhead (also the maximum interpolation depth will be exceeded at some point).
  // As a counter measure, we simply use the current position to update the current direction (and with it
  // the last label actions).
  // Strictly speaking, the current position is not necessarily the centroid of the label action. However,
  // calculating the actual centroid seems like overkill here (especially, for the interpolation case).
  // For the purposes of how this position is currently used in wK, passing the centered position is completely
  // sufficient.
  yield* put(registerLabelPointAction(position));
}

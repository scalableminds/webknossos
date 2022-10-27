import ops from "ndarray-ops";
import moments from "ndarray-moments";
import {
  ContourModeEnum,
  OrthoView,
  OverwriteMode,
  TypedArrayWithoutBigInt,
  Vector2,
  Vector3,
} from "oxalis/constants";
import PriorityQueue from "js-priority-queue";
import ErrorHandling from "libs/error_handling";

import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery, race, take } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  CancelQuickSelectAction,
  ComputeQuickSelectForRectAction,
  ConfirmQuickSelectAction,
  FineTuneQuickSelectAction,
  finishAnnotationStrokeAction,
  registerLabelPointAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import api from "oxalis/api/internal_api";
import ndarray from "ndarray";
import morphology from "ball-morphology";
import Toast from "libs/toast";
import {
  DatasetLayerConfiguration,
  OxalisState,
  QuickSelectConfig,
  VolumeTracing,
} from "oxalis/store";
import { RectangleGeometry } from "oxalis/geometries/helper_geometries";
import { clamp, take2 } from "libs/utils";
import { APIDataLayer } from "types/api_flow_types";
import { copyNdArray } from "./volume/volume_interpolation_saga";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import { EnterAction, EscapeAction, setIsQuickSelectActiveAction } from "../actions/ui_actions";
import {
  getEnabledColorLayers,
  getLayerBoundingBox,
  getResolutionInfo,
} from "../accessors/dataset_accessor";
import Dimensions from "../dimensions";
import { getRequestLogZoomStep } from "../accessors/flycam_accessor";
import { updateUserSettingAction } from "../actions/settings_actions";

// How large should the center rectangle be.
// Used to determine the mean intensity.
const CENTER_RECT_SIZE_PERCENTAGE = 1 / 10;

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    "COMPUTE_QUICK_SELECT_FOR_RECT",
    function* guard(action: ComputeQuickSelectForRectAction) {
      try {
        yield* put(setIsQuickSelectActiveAction(true));
        yield* call(performQuickSelect, action);
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setIsQuickSelectActiveAction(false));
      }
    },
  );
}

function* performQuickSelect(action: ComputeQuickSelectForRectAction): Saga<void> {
  const activeViewport = yield* select(
    (state: OxalisState) => state.viewModeData.plane.activeViewport,
  );
  const { rectangleGeometry } = action;
  if (activeViewport === "TDView") {
    // Can happen when the user ends the drag action in the 3D viewport
    console.warn("Ignoring quick select when mouse is in 3D viewport");
    rectangleGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    return;
  }
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const quickSelectConfig = yield* select((state) => state.userConfiguration.quickSelect);

  const colorLayers = yield* select((state: OxalisState) =>
    getEnabledColorLayers(state.dataset, state.datasetConfiguration),
  );
  if (colorLayers.length === 0) {
    Toast.warning("No color layer available to use for quickSelect feature");
    return;
  }

  const colorLayer = colorLayers[0];
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );

  const { startPosition, endPosition } = action;
  const boundingBoxObj = {
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  };

  const layerBBox = yield* select((state) => getLayerBoundingBox(state.dataset, colorLayer.name));
  const boundingBoxMag1 = new BoundingBox(boundingBoxObj).intersectedWith(layerBBox);

  rectangleGeometry.setCoordinates(boundingBoxMag1.min, boundingBoxMag1.max);

  const volumeTracing = yield* select(getActiveSegmentationTracing);

  if (!volumeTracing) {
    console.warn("No volumeTracing available.");
    return;
  }

  const requestedZoomStep = yield* select((store) => getRequestLogZoomStep(store));
  const resolutionInfo = getResolutionInfo(colorLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);

  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(labeledResolution);

  if (boundingBoxTarget.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  const inputDataRaw = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    colorLayer.name,
    boundingBoxMag1,
    labeledZoomStep,
  );
  const size = boundingBoxTarget.getSize();
  const stride = [1, size[0], size[0] * size[1]];

  if (inputDataRaw instanceof BigUint64Array) {
    throw new Error("Color input layer must not be 64-bit.");
  }

  const inputData = normalizeToUint8(colorLayer, inputDataRaw, layerConfiguration);
  const inputNdUvw = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  const centerUV = take2(V3.floor(V3.scale(inputNdUvw.shape as Vector3, 0.5)));
  // Two fields are computed (one for the dark segment scenario, and one for the light segment)
  const darkThresholdField = getThresholdField(inputNdUvw, centerUV, "dark");
  const lightThresholdField = getThresholdField(inputNdUvw, centerUV, "light");

  // Copy unthresholded fields so that finetuning is possible
  // without recomputing them. Only necessary if showPreview is true.
  const unthresholdedDarkCopy =
    quickSelectConfig.showPreview && copyNdArray(Uint8Array, darkThresholdField);
  const unthresholdedLightCopy =
    quickSelectConfig.showPreview && copyNdArray(Uint8Array, lightThresholdField);

  const { initialDetectDarkSegment, darkMaxEffectiveThresh, lightMinEffectiveThresh } =
    determineThresholds(darkThresholdField, lightThresholdField, inputNdUvw);

  // thresholdField initially stores the threshold values (uint8), but is
  // later processed to a binary mask.
  let thresholdField;
  if (initialDetectDarkSegment) {
    thresholdField = darkThresholdField;
    // In numpy-style this would be:
    // thresholdField[:] = thresholdField[:] < darkMaxEffectiveThresh
    ops.ltseq(thresholdField, darkMaxEffectiveThresh);
    yield* put(
      updateUserSettingAction("quickSelect", {
        ...quickSelectConfig,
        segmentMode: "dark",
        threshold: darkMaxEffectiveThresh,
      }),
    );
  } else {
    thresholdField = lightThresholdField;
    // In numpy-style this would be:
    // thresholdField[:] = thresholdField[:] > darkMaxEffectiveThresh
    ops.gtseq(thresholdField, lightMinEffectiveThresh);
    yield* put(
      updateUserSettingAction("quickSelect", {
        ...quickSelectConfig,
        segmentMode: "light",
        threshold: lightMinEffectiveThresh,
      }),
    );
  }

  processBinaryMaskInPlaceAndAttach(thresholdField, quickSelectConfig, rectangleGeometry);

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  if (!quickSelectConfig.showPreview) {
    yield* finalizeQuickSelect(
      rectangleGeometry,
      volumeTracing,
      activeViewport,
      labeledResolution,
      boundingBoxMag1,
      thirdDim,
      size,
      firstDim,
      secondDim,
      inputNdUvw,
      thresholdField,
      overwriteMode,
      labeledZoomStep,
    );
    return;
  }

  // Start an iterative feedback loop when preview mode is active.
  while (true) {
    const { finetuneAction, cancelQuickSelectAction, escape, enter, confirm } = (yield* race({
      finetuneAction: take("FINE_TUNE_QUICK_SELECT"),
      cancelQuickSelectAction: take("CANCEL_QUICK_SELECT"),
      escape: take("ESCAPE"),
      enter: take("ENTER"),
      confirm: take("CONFIRM_QUICK_SELECT"),
    })) as {
      finetuneAction: FineTuneQuickSelectAction;
      cancelQuickSelectAction: CancelQuickSelectAction;
      escape: EscapeAction;
      enter: EnterAction;
      confirm: ConfirmQuickSelectAction;
    };

    if (finetuneAction) {
      if (!unthresholdedDarkCopy || !unthresholdedLightCopy) {
        throw new Error("Unthresholded fields are not available");
      }
      if (finetuneAction.segmentMode === "dark") {
        thresholdField = copyNdArray(
          Uint8Array,
          unthresholdedDarkCopy,
        ) as ndarray.NdArray<Uint8Array>;
        ops.ltseq(thresholdField, finetuneAction.threshold);
      } else {
        thresholdField = copyNdArray(
          Uint8Array,
          unthresholdedLightCopy,
        ) as ndarray.NdArray<Uint8Array>;
        ops.gtseq(thresholdField, finetuneAction.threshold);
      }

      processBinaryMaskInPlaceAndAttach(thresholdField, finetuneAction, rectangleGeometry);
    } else if (cancelQuickSelectAction || escape) {
      rectangleGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
      return;
    } else if (confirm || enter) {
      yield* finalizeQuickSelect(
        rectangleGeometry,
        volumeTracing,
        activeViewport,
        labeledResolution,
        boundingBoxMag1,
        thirdDim,
        size,
        firstDim,
        secondDim,
        inputNdUvw,
        thresholdField,
        overwriteMode,
        labeledZoomStep,
      );
      return;
    }
  }
}

function getExtremeValueAtBorders(arr: ndarray.NdArray, mode: "min" | "max") {
  // Calculates the min or max value at the 4 borders of the array.
  const fn = mode === "min" ? Math.min : Math.max;
  const opsFn = mode === "min" ? ops.inf : ops.sup;
  return fn(
    opsFn(arr.pick(null, 0, 0)),
    opsFn(arr.pick(null, arr.shape[1] - 1, 0)),
    opsFn(arr.pick(0, null, 0)),
    opsFn(arr.pick(arr.shape[0] - 1, null, 0)),
  );
}

function determineThresholds(
  darkThresholdField: ndarray.NdArray<Uint8Array>,
  lightThresholdField: ndarray.NdArray<Uint8Array>,
  inputNdUvw: ndarray.NdArray<Uint8Array>,
) {
  // For dark segments, we are interested in the smallest threshold at the border
  // of the field.
  // For light segments, it's vice versa.
  const darkMinThresholdAtBorder = getExtremeValueAtBorders(darkThresholdField, "min");
  const lightMaxThresholdAtBorder = getExtremeValueAtBorders(lightThresholdField, "max");
  const darkSmallestThresh = ops.inf(darkThresholdField);
  const lightLargestThresh = ops.sup(lightThresholdField);

  // [Explained for the dark scenario]:
  // If the smallest threshold of the entire field is equal to the smallest threshold
  // at the border, it means that even the smallest threshold would create a segment
  // which touches the wall (which we aim to avoid). Using that smallest threshold, anyway,
  // wouldn't segment anything (because no value exists which is lower than the threshold).
  // In that rare case, we use that value + 1 so that at least anything is segmented.
  // If this happens, we likely switch from detecting dark to light segments (see below).
  const darkMaxEffectiveThresh = Math.max(darkMinThresholdAtBorder, darkSmallestThresh + 1);
  const lightMinEffectiveThresh = Math.min(lightMaxThresholdAtBorder, lightLargestThresh - 1);

  // Compute the mean intensity for the center rectangle and for the entire image.
  const rectCenterBrushExtentUV = V3.floor(
    V3.scale(inputNdUvw.shape as Vector3, CENTER_RECT_SIZE_PERCENTAGE),
  );
  const distToCenterRect = V3.floor(
    V3.sub(V3.scale(inputNdUvw.shape as Vector3, 0.5), rectCenterBrushExtentUV),
  );
  const subview = inputNdUvw
    .lo(distToCenterRect[0], distToCenterRect[1], 0)
    .hi(distToCenterRect[0], distToCenterRect[1], 1);
  const [centerMean] = moments(1, subview);
  const [mean] = moments(1, inputNdUvw);

  // If the center is darker than the entire image, we assume that a dark segment should be
  // detected.
  let initialDetectDarkSegment = centerMean < mean;

  // If the threshold is known to touch the rectangle border, we switch the mode.
  if (initialDetectDarkSegment && darkMaxEffectiveThresh > darkMinThresholdAtBorder) {
    console.info("Switch from detecting dark segment to detecting light segment");
    initialDetectDarkSegment = false;
  }
  if (!initialDetectDarkSegment && lightMinEffectiveThresh < lightMaxThresholdAtBorder) {
    console.info("Switch from detecting light segment to detecting dark segment");
    initialDetectDarkSegment = true;
  }
  return { initialDetectDarkSegment, darkMaxEffectiveThresh, lightMinEffectiveThresh };
}

function processBinaryMaskInPlaceAndAttach(
  output: ndarray.NdArray<Uint8Array>,
  quickSelectConfig: QuickSelectConfig,
  rectangleGeometry: RectangleGeometry,
) {
  fillHolesInPlace(output);
  morphology.close(output, quickSelectConfig.closeValue);
  morphology.erode(output, quickSelectConfig.erodeValue);
  morphology.dilate(output, quickSelectConfig.dilateValue);

  const outputRGBA = maskToRGBA(output);
  rectangleGeometry.attachTextureMask(outputRGBA, output.shape[0], output.shape[1]);
}

function normalizeToUint8(
  colorLayer: APIDataLayer,
  inputDataRaw: TypedArrayWithoutBigInt,
  layerConfiguration: DatasetLayerConfiguration,
): Uint8Array {
  if (colorLayer.elementClass === "uint8") {
    // Leave uint8 data as is
    return inputDataRaw as Uint8Array;
  }

  if (colorLayer.elementClass === "uint24") {
    // Convert RGB to grayscale by averaging the channels
    const inputData = new Uint8Array(inputDataRaw.length / 3);
    for (let idx = 0; idx < inputDataRaw.length; idx += 3) {
      inputData[idx / 3] = (inputDataRaw[idx] + inputDataRaw[idx + 1] + inputDataRaw[idx + 2]) / 3;
    }
    return inputData;
  }

  // Convert non uint8 data by scaling the values to uint8 (using the histogram settings)
  const inputData = new Uint8Array(inputDataRaw.length);
  const { intensityRange } = layerConfiguration;
  const [min, max] = intensityRange;
  // Scale the color value according to the histogram settings.
  const is_max_and_min_equal = Number(max === min);

  for (let idx = 0; idx < inputDataRaw.length; idx += 1) {
    let value = inputDataRaw[idx];
    value = clamp(min, value, max);
    // Note: max == min would cause a division by 0. Thus we add 1 to the divisor.
    // value will be 0 in that case (since value == min due to the clamp operation).
    value = (256 * (value - min)) / (max - min + is_max_and_min_equal);
    inputData[idx] = value;
  }

  return inputData;
}

function* finalizeQuickSelect(
  rectangleGeometry: RectangleGeometry,
  volumeTracing: VolumeTracing,
  activeViewport: OrthoView,
  labeledResolution: Vector3,
  boundingBoxMag1: BoundingBox,
  thirdDim: number,
  size: Vector3,
  firstDim: number,
  secondDim: number,
  inputNdUvw: ndarray.NdArray<TypedArrayWithoutBigInt>,
  output: ndarray.NdArray<TypedArrayWithoutBigInt>,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
) {
  rectangleGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
  const volumeLayer = yield* call(
    createVolumeLayer,
    volumeTracing,
    activeViewport,
    labeledResolution,
    boundingBoxMag1.min[thirdDim],
  );
  const voxelBuffer2D = volumeLayer.createVoxelBuffer2D(
    V2.floor(volumeLayer.globalCoordToMag2DFloat(boundingBoxMag1.min)),
    size[firstDim],
    size[secondDim],
  );

  for (let u = 0; u < inputNdUvw.shape[0]; u++) {
    for (let v = 0; v < inputNdUvw.shape[1]; v++) {
      if (output.get(u, v, 0) > 0) {
        voxelBuffer2D.setValue(u, v, 1);
      }
    }
  }

  yield* call(
    labelWithVoxelBuffer2D,
    voxelBuffer2D,
    ContourModeEnum.DRAW,
    overwriteMode,
    labeledZoomStep,
    activeViewport,
  );
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
  yield* put(registerLabelPointAction(boundingBoxMag1.getCenter()));
}

function maskToRGBA(output: ndarray.NdArray<Uint8Array>) {
  const channelCount = 4;
  const outputRGBA = new Uint8Array(output.size * channelCount);
  let idx = 0;

  const max = ops.sup(output);
  const min = ops.inf(output);

  for (let v = 0; v < output.shape[1]; v++) {
    for (let u = 0; u < output.shape[0]; u++) {
      const val = (255 * (output.get(u, v, 0) - min)) / (max - min);
      outputRGBA[idx] = val;
      outputRGBA[idx + 1] = val;
      outputRGBA[idx + 2] = val;
      outputRGBA[idx + 3] = val;
      idx += channelCount;
    }
  }
  return outputRGBA;
}

type PriorityItem = {
  coords: Vector2;
  threshold: number;
};

const NEIGHBOR_OFFSETS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function getThresholdField(
  inputNdUvw: ndarray.NdArray<Uint8Array>,
  centerUV: Vector2,
  mode: "light" | "dark",
): ndarray.NdArray<Uint8Array> {
  // Computes a threshold field starting from the center
  // so that there is a value for each voxel that indicates
  // which threshold is necessary so that a floodfill operation
  // can arrive at that voxel.
  // When detecting dark segments (mode == "dark), the floodfill
  // begins at low intensity values and walks towards higher values in the end.
  // For light segments, it's vice versa.

  const comparator =
    mode === "dark"
      ? // low priority values take precedence
        (b: PriorityItem, a: PriorityItem) => b.threshold - a.threshold
      : // high priority values take precedence
        (b: PriorityItem, a: PriorityItem) => a.threshold - b.threshold;
  const queue = new PriorityQueue({
    comparator,
  });

  // For each voxel, store a boolean to denote whether it's been visited
  const visitedField = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);
  // For each voxel, store the threshold which is necessary to reach that voxel
  const thresholdField = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);

  queue.queue({ coords: centerUV, threshold: inputNdUvw.get(centerUV[0], centerUV[1], 0) });

  // extremeThreshold is either the min or maximum value
  // of all seen values at the current time.
  let extremeThreshold = mode === "dark" ? 0 : Infinity;
  const extremeFn = mode === "dark" ? Math.max : Math.min;
  while (queue.length > 0) {
    const { coords, threshold } = queue.dequeue();

    if (visitedField.get(coords[0], coords[1], 0) > 0) {
      continue;
    }
    visitedField.set(coords[0], coords[1], 0, 1);

    extremeThreshold = extremeFn(threshold, extremeThreshold);
    thresholdField.set(coords[0], coords[1], 0, extremeThreshold);

    for (const offset of NEIGHBOR_OFFSETS) {
      const newCoord = V2.add(coords, offset);
      if (
        newCoord[0] >= 0 &&
        newCoord[1] >= 0 &&
        newCoord[0] < inputNdUvw.shape[0] &&
        newCoord[1] < inputNdUvw.shape[1]
      ) {
        const newThreshold = inputNdUvw.get(newCoord[0], newCoord[1], 0);
        queue.queue({
          coords: newCoord,
          threshold: newThreshold,
        });
      }
    }
  }
  return thresholdField;
}

function fillHolesInPlace(arr: ndarray.NdArray<Uint8Array>) {
  // Execute a flood-fill on the "outside" of the segment
  // and afterwards, invert the image to get a segment
  // within which all holes are filled.

  // First, set the four borders to zero so that we know
  // that the top-left pixel is "outside" of the segment
  // and can be used as a starting point for the floodfill.
  // Theoretically, we could remember which voxels were
  // changed from 1 to 0, but in practice, it doesn't really matter
  // that the borders are zero'd. The user likely has used a
  // "safety margin" when drawing the rectangle, anyway.
  const borders = [
    arr.pick(null, 0, 0),
    arr.pick(null, arr.shape[1] - 1, 0),
    arr.pick(0, null, 0),
    arr.pick(arr.shape[0] - 1, null, 0),
  ];
  for (const border of borders) {
    ops.assigns(border, 0);
  }

  // Store the visited voxels in visitedField.
  const visitedField = ndarray(new Uint8Array(arr.size), arr.shape);
  const queue: Vector2[] = [[0, 0]];

  while (queue.length > 0) {
    const coords = queue.pop() as Vector2;

    if (visitedField.get(coords[0], coords[1], 0) > 0) {
      continue;
    }
    visitedField.set(coords[0], coords[1], 0, 1);

    for (const offset of NEIGHBOR_OFFSETS) {
      const newCoord = V2.add(coords, offset);
      if (
        newCoord[0] >= 0 &&
        newCoord[1] >= 0 &&
        newCoord[0] < arr.shape[0] &&
        newCoord[1] < arr.shape[1]
      ) {
        const neighborValue = arr.get(newCoord[0], newCoord[1], 0);
        if (neighborValue === 0) {
          queue.push(newCoord);
        }
      }
    }
  }

  // Invert the visitedField and write it to arr.
  // With numpy, this would be
  //   arr = visitedField[:] == 0
  ops.eqs(arr, visitedField, 0);
}

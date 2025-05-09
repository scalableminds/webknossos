import PriorityQueue from "js-priority-queue";
import _ from "lodash";
import moments from "ndarray-moments";
import ops from "ndarray-ops";
import {
  ContourModeEnum,
  type OrthoView,
  type OrthoViewWithoutTD,
  type OverwriteMode,
  type TypedArrayWithoutBigInt,
  type Vector2,
  type Vector3,
} from "viewer/constants";

import { sendAnalyticsEvent } from "admin/rest_api";
import morphology from "ball-morphology";
import { V2, V3 } from "libs/mjs";
import Toast from "libs/toast";
import { clamp, map3, take2 } from "libs/utils";
import ndarray from "ndarray";
import { call, put, race, take } from "typed-redux-saga";
import type { APIDataLayer, APIDataset } from "types/api_types";
import type { QuickSelectGeometry } from "viewer/geometries/helper_geometries";
import {
  getActiveSegmentationTracing,
  getSegmentationLayerForTracing,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  type CancelQuickSelectAction,
  type ComputeQuickSelectForPointAction,
  type ComputeQuickSelectForRectAction,
  type ConfirmQuickSelectAction,
  type FineTuneQuickSelectAction,
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { api } from "viewer/singletons";
import type {
  DatasetLayerConfiguration,
  QuickSelectConfig,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import {
  getDefaultValueRangeOfLayer,
  getEnabledColorLayers,
  getLayerBoundingBox,
  getMagInfo,
} from "../accessors/dataset_accessor";
import { getTransformsForLayer } from "../accessors/dataset_layer_transformation_accessor";
import { getActiveMagIndexForLayer } from "../accessors/flycam_accessor";
import { updateUserSettingAction } from "../actions/settings_actions";
import {
  type EnterAction,
  type EscapeAction,
  showQuickSelectSettingsAction,
} from "../actions/ui_actions";
import Dimensions, { type DimensionIndices } from "../dimensions";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import { copyNdArray } from "./volume/volume_interpolation_saga";

const TOAST_KEY = "QUICKSELECT_PREVIEW_MESSAGE";

// How large should the center rectangle be.
// Used to determine the mean intensity.
const CENTER_RECT_SIZE_PERCENTAGE = 1 / 10;

const warnAboutMultipleColorLayers = _.memoize((layerName: string) => {
  Toast.info(
    `The quick select tool will use the data of layer ${layerName}. If you want to use another layer, please hide the other non-segmentation layers.`,
  );
});

let wasPreviewModeToastAlreadyShown = false;

export function* prepareQuickSelect(
  action: ComputeQuickSelectForRectAction | ComputeQuickSelectForPointAction,
): Saga<{
  labeledZoomStep: number;
  firstDim: DimensionIndices;
  secondDim: DimensionIndices;
  thirdDim: DimensionIndices;
  colorLayer: APIDataLayer;
  quickSelectConfig: QuickSelectConfig;
  activeViewport: OrthoViewWithoutTD;
  labeledMag: Vector3;
  volumeTracing: VolumeTracing;
} | null> {
  const activeViewport = yield* select(
    (state: WebknossosState) => state.viewModeData.plane.activeViewport,
  );
  if (activeViewport === "TDView") {
    // Can happen when the user ends the drag action in the 3D viewport
    console.warn("Ignoring quick select when mouse is in 3D viewport");
    const { quickSelectGeometry } = action;
    quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    return null;
  }
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const quickSelectConfig = yield* select((state) => state.userConfiguration.quickSelect);

  const colorLayers = yield* select((state: WebknossosState) =>
    getEnabledColorLayers(state.dataset, state.datasetConfiguration),
  );
  if (colorLayers.length === 0) {
    Toast.warning("No color layer available to use for quick select feature");
    return null;
  }

  const colorLayer = colorLayers[0];

  if (colorLayers.length > 1) {
    warnAboutMultipleColorLayers(colorLayer.name);
  }

  const volumeTracing = yield* select(getActiveSegmentationTracing);

  if (!volumeTracing) {
    console.warn("No volumeTracing available.");
    return null;
  }
  const volumeLayer = yield* select((state) =>
    getSegmentationLayerForTracing(state, volumeTracing),
  );
  const dataset = yield* select((state) => state.dataset);
  const nativelyRenderedLayerName = yield* select(
    (state) => state.datasetConfiguration.nativelyRenderedLayerName,
  );
  if (
    !_.isEqual(
      getTransformsForLayer(dataset, colorLayer, nativelyRenderedLayerName),
      getTransformsForLayer(dataset, volumeLayer, nativelyRenderedLayerName),
    )
  ) {
    Toast.warning(
      "Quick select is currently not supported if the color and volume layer use different transforms.",
    );
    return null;
  }

  const requestedZoomStep = yield* select((store) =>
    getActiveMagIndexForLayer(store, colorLayer.name),
  );
  const magInfo = getMagInfo(
    // Ensure that a magnification is used which exists in the color layer as well as the
    // target segmentation layer.
    _.intersectionBy(colorLayer.resolutions, volumeLayer.resolutions, (mag) => mag.join("-")),
  );
  const labeledZoomStep = magInfo.getClosestExistingIndex(
    requestedZoomStep,
    "The visible color layer and the active segmentation layer don't have any magnifications in common. Cannot select segment.",
  );
  const labeledMag = magInfo.getMagByIndexOrThrow(labeledZoomStep);

  return {
    labeledZoomStep,
    firstDim,
    secondDim,
    thirdDim,
    colorLayer,
    quickSelectConfig,
    activeViewport,
    labeledMag,
    volumeTracing,
  };
}

export default function* performQuickSelect(
  action: ComputeQuickSelectForRectAction | ComputeQuickSelectForPointAction,
): Saga<void> {
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null || action.type === "COMPUTE_QUICK_SELECT_FOR_POINT") {
    return;
  }
  const {
    labeledZoomStep,
    firstDim,
    secondDim,
    thirdDim,
    colorLayer,
    quickSelectConfig,
    activeViewport,
    labeledMag,
    volumeTracing,
  } = preparation;
  const { startPosition, endPosition, quickSelectGeometry } = action;

  const layerBBox = yield* select((state) => getLayerBoundingBox(state.dataset, colorLayer.name));
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);

  const boundingBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  }).intersectedWith(layerBBox);

  // Ensure that the third dimension is inclusive (otherwise, the center of the passed
  // coordinates wouldn't be exactly on the W plane on which the user started this action).
  const inclusiveMaxW = map3((el, idx) => (idx === thirdDim ? el - 1 : el), boundingBoxMag1.max);
  quickSelectGeometry.setCoordinates(boundingBoxMag1.min, inclusiveMaxW);

  const boundingBoxInMag = boundingBoxMag1.fromMag1ToMag(labeledMag);

  if (boundingBoxInMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  const inputDataRaw = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    colorLayer.name,
    boundingBoxMag1,
    labeledZoomStep,
    additionalCoordinates,
  );
  const size = boundingBoxInMag.getSize();
  const stride = [1, size[0], size[0] * size[1]];

  if (inputDataRaw instanceof BigUint64Array || inputDataRaw instanceof BigInt64Array) {
    throw new Error("Color input layer must not be 64-bit.");
  }

  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const dataset = yield* select((state) => state.dataset);
  const inputData = normalizeToUint8(colorLayer, inputDataRaw, layerConfiguration, dataset);
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

  processBinaryMaskInPlaceAndAttach(thresholdField, quickSelectConfig, quickSelectGeometry);

  const overwriteMode = yield* select(
    (state: WebknossosState) => state.userConfiguration.overwriteMode,
  );

  if (!quickSelectConfig.showPreview) {
    sendAnalyticsEvent("used_quick_select_without_preview");
    yield* finalizeQuickSelectForSlice(
      quickSelectGeometry,
      volumeTracing,
      activeViewport,
      labeledMag,
      boundingBoxMag1,
      boundingBoxMag1.min[thirdDim],
      thresholdField,
      overwriteMode,
      labeledZoomStep,
    );
    return;
  }

  // Start an iterative feedback loop when preview mode is active.

  if (!wasPreviewModeToastAlreadyShown) {
    // Explain how the preview mode works only once. The opened settings panel
    // should be a good indicator for later usages that the preview mode is active.
    wasPreviewModeToastAlreadyShown = true;
    yield* call(
      [Toast, Toast.info],
      "The quick select tool is currently in preview mode. Use the settings in the toolbar to refine the selection or confirm/cancel the selection (e.g., with Enter/Escape).",
      { key: TOAST_KEY, sticky: true },
    );
  }
  yield* put(showQuickSelectSettingsAction(true));

  while (true) {
    const { finetuneAction, cancel, escape, enter, confirm } = (yield* race({
      finetuneAction: take("FINE_TUNE_QUICK_SELECT"),
      cancel: take("CANCEL_QUICK_SELECT"),
      escape: take("ESCAPE"),
      enter: take("ENTER"),
      confirm: take("CONFIRM_QUICK_SELECT"),
    })) as {
      finetuneAction: FineTuneQuickSelectAction;
      cancel: CancelQuickSelectAction;
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

      processBinaryMaskInPlaceAndAttach(thresholdField, finetuneAction, quickSelectGeometry);
    } else if (cancel || escape) {
      sendAnalyticsEvent("cancelled_quick_select_preview");
      quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
      yield* call([Toast, Toast.close], TOAST_KEY);
      return;
    } else if (confirm || enter) {
      sendAnalyticsEvent("confirmed_quick_select_preview");

      yield* finalizeQuickSelectForSlice(
        quickSelectGeometry,
        volumeTracing,
        activeViewport,
        labeledMag,
        boundingBoxMag1,
        boundingBoxMag1.min[thirdDim],
        thresholdField,
        overwriteMode,
        labeledZoomStep,
      );
      yield* call([Toast, Toast.close], TOAST_KEY);
      yield* put(showQuickSelectSettingsAction(true));
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
  const centerAreaSubview = getCenterSubview(inputNdUvw);
  const [centerMean] = moments(1, centerAreaSubview);
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

function getCenterSubview(inputNdUvw: ndarray.NdArray<Uint8Array>) {
  const rectCenterExtentUV = V3.floor(
    V3.scale(inputNdUvw.shape as Vector3, CENTER_RECT_SIZE_PERCENTAGE),
  );
  const distToCenterRect = V3.floor(
    V3.scale(V3.sub(inputNdUvw.shape as Vector3, rectCenterExtentUV), 0.5),
  );
  const centerAreaSubview = inputNdUvw
    // a.lo(x,y) => a[x:, y:]
    .lo(distToCenterRect[0], distToCenterRect[1], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(rectCenterExtentUV[0], rectCenterExtentUV[1], 1);
  return centerAreaSubview;
}

function processBinaryMaskInPlaceAndAttach(
  mask: ndarray.NdArray<Uint8Array>,
  quickSelectConfig: Omit<QuickSelectConfig, "showPreview" | "useHeuristic" | "predictionDepth">,
  quickSelectGeometry: QuickSelectGeometry,
) {
  fillHolesInPlace(mask);
  morphology.close(mask, quickSelectConfig.closeValue);
  morphology.erode(mask, quickSelectConfig.erodeValue);
  morphology.dilate(mask, quickSelectConfig.dilateValue);

  const maskRGBA = maskToRGBA(mask);
  quickSelectGeometry.attachTextureMask(maskRGBA, mask.shape[0], mask.shape[1]);
}

function normalizeToUint8(
  colorLayer: APIDataLayer,
  inputDataRaw: TypedArrayWithoutBigInt,
  layerConfiguration: DatasetLayerConfiguration,
  dataset: APIDataset,
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
  const defaultIntensityRange = getDefaultValueRangeOfLayer(dataset, colorLayer.name);
  const [min, max] = intensityRange || defaultIntensityRange;
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

export function* finalizeQuickSelectForSlice(
  quickSelectGeometry: QuickSelectGeometry,
  volumeTracing: VolumeTracing,
  activeViewport: OrthoView,
  labeledMag: Vector3,
  boundingBoxMag1: BoundingBox,
  w: number,
  mask: ndarray.NdArray<TypedArrayWithoutBigInt>,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
  skipFinishAnnotationStroke: boolean = false,
) {
  quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
  const volumeLayer = yield* call(createVolumeLayer, volumeTracing, activeViewport, labeledMag, w);
  const sizeUVWInMag = mask.shape;
  const voxelBuffer2D = volumeLayer.createVoxelBuffer2D(
    V2.floor(volumeLayer.globalCoordToMag2DFloat(boundingBoxMag1.min)),
    sizeUVWInMag[0],
    sizeUVWInMag[1],
  );

  for (let u = 0; u < sizeUVWInMag[0]; u++) {
    for (let v = 0; v < sizeUVWInMag[1]; v++) {
      // w = 0 is correct because the correct 3rd dim was already sliced
      // by the caller.
      if (mask.get(u, v, 0) > 0) {
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
  if (boundingBoxMag1.getCenter().some((el) => el == null)) {
    throw new Error("invalid bbox");
  }
  if (!skipFinishAnnotationStroke) {
    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
  }
  yield* put(registerLabelPointAction(boundingBoxMag1.getCenter()));
  yield* put(
    updateSegmentAction(
      volumeTracing.activeCellId,
      {
        somePosition: boundingBoxMag1.getCenter(),
      },
      volumeTracing.tracingId,
    ),
  );
}

function maskToRGBA(mask: ndarray.NdArray<Uint8Array>) {
  // Create an RGBA mask from the single-channel input, since this is needed
  // to create a texture for the rectangle preview.
  const channelCount = 4;
  const maskRGBA = new Uint8Array(mask.size * channelCount);
  let idx = 0;

  const max = ops.sup(mask);
  const min = ops.inf(mask);

  const normalize =
    max === min
      ? // Avoid division by zero
        (val: number) => (val > 0 ? 255 : 0)
      : (val: number) => (255 * (val - min)) / (max - min);

  for (let v = 0; v < mask.shape[1]; v++) {
    for (let u = 0; u < mask.shape[0]; u++) {
      let val = normalize(mask.get(u, v, 0));
      if (u === 0 || v === 0 || u === mask.shape[0] - 1 || v === mask.shape[1] - 1) {
        // Make border pixels always visible so that the user can recognize the
        // preview state better. These pixels are only painted in the preview texture
        // and won't be annotated when confirming the preview.
        val = 255;
      }
      maskRGBA[idx] = val;
      maskRGBA[idx + 1] = val;
      maskRGBA[idx + 2] = val;
      maskRGBA[idx + 3] = val;
      idx += channelCount;
    }
  }
  return maskRGBA;
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

  // Fill center so that the watershed essentially starts
  // from a seed area instead of a single point.
  // Note that we mutate the input array in-place. To avoid
  // this side-effect, we make a copy of the center array
  // and restore it at the end of this function.
  const centerAreaSubview = getCenterSubview(inputNdUvw);
  const centerBackup = copyNdArray(Uint8Array, centerAreaSubview);
  ops.assigns(centerAreaSubview, mode === "light" ? 255 : 0);

  // For each voxel, store a boolean to denote whether it's been visited
  const visitedField = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);
  // For each voxel, store the threshold which is necessary to reach that voxel
  const thresholdField = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);

  queue.queue({ coords: centerUV, threshold: inputNdUvw.get(centerUV[0], centerUV[1], 0) });

  // extremeThreshold is either the min or maximum value
  // of all seen values at the current time.
  let extremeThreshold = mode === "dark" ? 0 : Number.POSITIVE_INFINITY;
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

  ops.assign(centerAreaSubview, centerBackup);

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

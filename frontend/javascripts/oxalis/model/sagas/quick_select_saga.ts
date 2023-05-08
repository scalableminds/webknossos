import _ from "lodash";
import * as ort from "onnxruntime-web";

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
import {
  getActiveSegmentationTracing,
  getSegmentationLayerForTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  CancelQuickSelectAction,
  ComputeQuickSelectForRectAction,
  ConfirmQuickSelectAction,
  FineTuneQuickSelectAction,
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { api } from "oxalis/singletons";
import ndarray from "ndarray";
import morphology from "ball-morphology";
import Toast from "libs/toast";
import {
  DatasetLayerConfiguration,
  OxalisState,
  QuickSelectConfig,
  VolumeTracing,
} from "oxalis/store";
import { QuickSelectGeometry } from "oxalis/geometries/helper_geometries";
import { clamp, map3, take2 } from "libs/utils";
import { APIDataLayer, APIDataset } from "types/api_flow_types";
import { sendAnalyticsEvent } from "admin/admin_rest_api";
import { copyNdArray } from "./volume/volume_interpolation_saga";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import {
  EnterAction,
  EscapeAction,
  setIsQuickSelectActiveAction,
  showQuickSelectSettingsAction,
} from "../actions/ui_actions";
import {
  getEnabledColorLayers,
  getLayerBoundingBox,
  getResolutionInfo,
  getTransformsForLayer,
} from "../accessors/dataset_accessor";
import Dimensions from "../dimensions";
import { getActiveMagIndexForLayer } from "../accessors/flycam_accessor";
import { updateUserSettingAction } from "../actions/settings_actions";
import { InferenceSession } from "onnxruntime-web";

const TOAST_KEY = "QUICKSELECT_PREVIEW_MESSAGE";

// How large should the center rectangle be.
// Used to determine the mean intensity.
const CENTER_RECT_SIZE_PERCENTAGE = 1 / 10;

let _embedding: Float32Array | null = null;
// let _hardcodedEmbedding: Float32Array | null = null;

const useHardcodedEmbedding = false;

const embeddingCache = [];

async function getEmbedding(dataset: APIDataset, boundingBox: BoundingBox, mag: Vector3) {
  try {
    // todo: use caching
    _embedding = null;
    if (_embedding == null) {
      _embedding = new Float32Array(
        (await fetch(
          `/api/datasets/${dataset.owningOrganization}/${dataset.name}/layers/color/segmentAnythingEmbedding`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              mag,
              boundingBox: boundingBox.asServerBoundingBox(),
            }),
          },
        ).then((res) => res.arrayBuffer())) as ArrayBuffer,
      );

      // _hardcodedEmbedding = new Float32Array(
      //   (await fetch("/dist/paper_l4_embedding.bin").then((res) =>
      //     res.arrayBuffer(),
      //   )) as ArrayBuffer,
      // );
    }
    // console.log("_hardcodedEmbedding", _hardcodedEmbedding.slice(0, 20));
    // if (useHardcodedEmbedding) {
    //   return _hardcodedEmbedding;
    // }
    return _embedding;
  } catch (exception) {
    console.error(exception);
    throw new Error("Could not load embedding. See console for details.");
  }
}

let session: InferenceSession | null;

async function getSession() {
  if (session == null) {
    session = await ort.InferenceSession.create(
      "/assets/models/vit_l_0b3195_decoder_quantized.onnx",
    );
  }
  return session;
}

async function inferFromEmbedding(embedding: Float32Array, topLeft: Vector3, bottomRight: Vector3) {
  const ort_session = await getSession();
  const onnx_coord = useHardcodedEmbedding
    ? new Float32Array([topLeft[1], topLeft[0], bottomRight[1], bottomRight[0]])
    : new Float32Array([topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]]);
  const onnx_label = new Float32Array([2, 3]);
  const onnx_mask_input = new Float32Array(256 * 256);
  const onnx_has_mask_input = new Float32Array([0]);
  const orig_im_size = new Float32Array([1024, 1024]);
  const ort_inputs = {
    image_embeddings: new ort.Tensor("float32", embedding, [1, 256, 64, 64]),
    point_coords: new ort.Tensor("float32", onnx_coord, [1, 2, 2]),
    point_labels: new ort.Tensor("float32", onnx_label, [1, 2]),
    mask_input: new ort.Tensor("float32", onnx_mask_input, [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", onnx_has_mask_input, [1]),
    orig_im_size: new ort.Tensor("float32", orig_im_size, [2]),
  };
  console.log(ort_inputs);
  const { masks, iou_predictions, low_res_masks } = await ort_session.run(ort_inputs);
  console.log([masks, iou_predictions, low_res_masks]);
  // @ts-ignore
  const best_mask_index = iou_predictions.data.indexOf(Math.max(...iou_predictions.data));
  const thresholded_mask = masks.data
    .slice(best_mask_index * 1024 * 1024, (best_mask_index + 1) * 1024 * 1024)
    // todo use nd array
    // @ts-ignore
    .map((e) => e > 0);

  console.log("thresholded_mask", thresholded_mask);

  // @ts-ignore
  return new Uint8Array(thresholded_mask);
}

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
        action.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        yield* put(setIsQuickSelectActiveAction(false));
      }
    },
  );
}

const warnAboutMultipleColorLayers = _.memoize((layerName: string) => {
  Toast.info(
    `The quick select tool will use the data of layer ${layerName}. If you want to use another layer, please hide the other non-segmentation layers.`,
  );
});

// let wasPreviewModeToastAlreadyShown = false;

function* performQuickSelect(action: ComputeQuickSelectForRectAction): Saga<void> {
  const dataset = yield* select((state: OxalisState) => state.dataset);
  const activeViewport = yield* select(
    (state: OxalisState) => state.viewModeData.plane.activeViewport,
  );
  const { quickSelectGeometry } = action;
  if (activeViewport === "TDView") {
    // Can happen when the user ends the drag action in the 3D viewport
    console.warn("Ignoring quick select when mouse is in 3D viewport");
    quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    return;
  }
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  // const quickSelectConfig = yield* select((state) => state.userConfiguration.quickSelect);

  const colorLayers = yield* select((state: OxalisState) =>
    getEnabledColorLayers(state.dataset, state.datasetConfiguration),
  );
  if (colorLayers.length === 0) {
    Toast.warning("No color layer available to use for quick select feature");
    return;
  }

  const colorLayer = colorLayers[0];

  if (colorLayers.length > 1) {
    warnAboutMultipleColorLayers(colorLayer.name);
  }

  // const layerConfiguration = yield* select(
  //   (state) => state.datasetConfiguration.layers[colorLayer.name],
  // );

  // const embeddingTopLeft = [2816, 4133, 1728] as Vector3; daniels DS
  // const embeddingTopLeft = [1032, 1030, 1536] as Vector3; // l4_v2_sample

  const { startPosition, endPosition } = action;

  const embeddingCenter = V3.round(V3.scale(V3.add(startPosition, endPosition), 0.5));
  const embeddingTopLeft = V3.sub(embeddingCenter, [512, 512, 0]);

  const embeddingBottomRight = [
    embeddingTopLeft[0] + 1024,
    embeddingTopLeft[1] + 1024,
    embeddingTopLeft[2],
  ] as Vector3;

  const relativeTopLeft = V3.sub(startPosition, embeddingTopLeft);
  const relativeBottomRight = V3.sub(endPosition, embeddingTopLeft);

  const userBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  });

  // const layerBBox = yield* select((state) => getLayerBoundingBox(state.dataset, colorLayer.name));
  const embeddingBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(embeddingTopLeft, embeddingBottomRight)),
    max: V3.floor(
      V3.add(
        V3.max(embeddingTopLeft, embeddingBottomRight),
        Dimensions.transDim([0, 0, 1], activeViewport),
      ),
    ),
  }); //.intersectedWith(layerBBox);

  // Ensure that the third dimension is inclusive (otherwise, the center of the passed
  // coordinates wouldn't be exactly on the W plane on which the user started this action).
  const inclusiveMaxW = map3((el, idx) => (idx === thirdDim ? el - 1 : el), userBoxMag1.max);
  quickSelectGeometry.setCoordinates(userBoxMag1.min, inclusiveMaxW);

  const volumeTracing = yield* select(getActiveSegmentationTracing);

  if (!volumeTracing) {
    console.warn("No volumeTracing available.");
    return;
  }
  const volumeLayer = yield* select((state) =>
    getSegmentationLayerForTracing(state, volumeTracing),
  );

  if (!_.isEqual(getTransformsForLayer(colorLayer), getTransformsForLayer(volumeLayer))) {
    Toast.warning(
      "Quick select is currently not supported if the color and volume layer use different transforms.",
    );
    return;
  }

  const requestedZoomStep = yield* select((store) =>
    getActiveMagIndexForLayer(store, colorLayer.name),
  );
  const resolutionInfo = getResolutionInfo(
    // Ensure that a magnification is used which exists in the color layer as well as the
    // target segmentation layer.
    _.intersectionBy(colorLayer.resolutions, volumeLayer.resolutions, (mag) => mag.join("-")),
  );
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(
    requestedZoomStep,
    "The visible color layer and the active segmentation layer don't have any magnifications in common. Cannot select segment.",
  );
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);

  const embeddingBoxInTargetMag = embeddingBoxMag1.fromMag1ToMag(labeledResolution);
  const userBoxInTargetMag = userBoxMag1.fromMag1ToMag(labeledResolution);

  if (embeddingBoxInTargetMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  // const inputDataRaw = yield* call(
  //   [api.data, api.data.getDataForBoundingBox],
  //   colorLayer.name,
  //   embeddingBoxMag1,
  //   labeledZoomStep,
  // );

  // const inputFromServer = yield* call(
  //   [api.data, api.data.downloadRawDataCuboid],
  //   colorLayer.name,
  //   embeddingTopLeft,
  //   embeddingBottomRight,
  // );

  const size = embeddingBoxInTargetMag.getSize();
  if (size.some((el) => el !== 1 && el !== 1024)) {
    throw new Error("Incorrectly sized window");
  }

  const stride = [1, size[0], size[0] * size[1]];
  console.log("stride", stride);

  // if (inputDataRaw instanceof BigUint64Array) {
  //   throw new Error("Color input layer must not be 64-bit.");
  // }

  // const inputData = normalizeToUint8(colorLayer, inputDataRaw, layerConfiguration);
  // const inputNdUvw = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  // const centerUV = take2(V3.floor(V3.scale(inputNdUvw.shape as Vector3, 0.5)));
  // Two fields are computed (one for the dark segment scenario, and one for the light segment)
  // const darkThresholdField = getThresholdField(inputNdUvw, centerUV, "dark");
  // const lightThresholdField = getThresholdField(inputNdUvw, centerUV, "light");

  // Copy unthresholded fields so that finetuning is possible
  // without recomputing them. Only necessary if showPreview is true.
  // const unthresholdedDarkCopy =
  //   quickSelectConfig.showPreview && copyNdArray(Uint8Array, darkThresholdField);
  // const unthresholdedLightCopy =
  //   quickSelectConfig.showPreview && copyNdArray(Uint8Array, lightThresholdField);

  // const { initialDetectDarkSegment, darkMaxEffectiveThresh, lightMinEffectiveThresh } =
  //   determineThresholds(darkThresholdField, lightThresholdField, inputNdUvw);

  // thresholdField initially stores the threshold values (uint8), but is
  // later processed to a binary mask.

  console.time("getEmbedding");
  const embedding = yield* call(getEmbedding, dataset, embeddingBoxMag1, [1, 1, 1]);
  console.timeEnd("getEmbedding");

  console.time("infer");
  let thresholdFieldData = yield* call(
    inferFromEmbedding,
    embedding,
    relativeTopLeft,
    relativeBottomRight,
  );
  console.timeEnd("infer");
  let thresholdField = ndarray(thresholdFieldData, size, stride);

  if (useHardcodedEmbedding) {
    thresholdField = thresholdField.transpose(1, 0, 2);
  }

  thresholdField = thresholdField
    // a.lo(x,y) => a[x:, y:]
    .lo(relativeTopLeft[0], relativeTopLeft[1], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(userBoxInTargetMag.getSize()[0], userBoxInTargetMag.getSize()[1], 1);

  // if (initialDetectDarkSegment) {
  //   thresholdField = darkThresholdField;
  //   // In numpy-style this would be:
  //   // thresholdField[:] = thresholdField[:] < darkMaxEffectiveThresh
  //   ops.ltseq(thresholdField, darkMaxEffectiveThresh);
  //   yield* put(
  //     updateUserSettingAction("quickSelect", {
  //       ...quickSelectConfig,
  //       segmentMode: "dark",
  //       threshold: darkMaxEffectiveThresh,
  //     }),
  //   );
  // } else {
  //   thresholdField = lightThresholdField;
  //   // In numpy-style this would be:
  //   // thresholdField[:] = thresholdField[:] > darkMaxEffectiveThresh
  //   ops.gtseq(thresholdField, lightMinEffectiveThresh);
  //   yield* put(
  //     updateUserSettingAction("quickSelect", {
  //       ...quickSelectConfig,
  //       segmentMode: "light",
  //       threshold: lightMinEffectiveThresh,
  //     }),
  //   );
  // }

  // processBinaryMaskInPlaceAndAttach(thresholdField, quickSelectConfig, quickSelectGeometry);

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  // if (!quickSelectConfig.showPreview) {
  sendAnalyticsEvent("used_quick_select_without_preview");
  yield* finalizeQuickSelect(
    quickSelectGeometry,
    volumeTracing,
    activeViewport,
    labeledResolution,
    userBoxMag1,
    thirdDim,
    userBoxInTargetMag.getSize(),
    firstDim,
    secondDim,
    // inputNdUvw,
    thresholdField,
    overwriteMode,
    labeledZoomStep,
  );
  // return;
  // }

  // // Start an iterative feedback loop when preview mode is active.

  // if (!wasPreviewModeToastAlreadyShown) {
  //   // Explain how the preview mode works only once. The opened settings panel
  //   // should be a good indicator for later usages that the preview mode is active.
  //   wasPreviewModeToastAlreadyShown = true;
  //   yield* call(
  //     [Toast, Toast.info],
  //     "The quick select tool is currently in preview mode. Use the settings in the toolbar to refine the selection or confirm/cancel the selection (e.g., with Enter/Escape).",
  //     { key: TOAST_KEY, sticky: true },
  //   );
  // }
  // yield* put(showQuickSelectSettingsAction(true));

  // while (true) {
  //   const { finetuneAction, cancel, escape, enter, confirm } = (yield* race({
  //     finetuneAction: take("FINE_TUNE_QUICK_SELECT"),
  //     cancel: take("CANCEL_QUICK_SELECT"),
  //     escape: take("ESCAPE"),
  //     enter: take("ENTER"),
  //     confirm: take("CONFIRM_QUICK_SELECT"),
  //   })) as {
  //     finetuneAction: FineTuneQuickSelectAction;
  //     cancel: CancelQuickSelectAction;
  //     escape: EscapeAction;
  //     enter: EnterAction;
  //     confirm: ConfirmQuickSelectAction;
  //   };

  //   if (finetuneAction) {
  //     if (!unthresholdedDarkCopy || !unthresholdedLightCopy) {
  //       throw new Error("Unthresholded fields are not available");
  //     }
  //     if (finetuneAction.segmentMode === "dark") {
  //       thresholdField = copyNdArray(
  //         Uint8Array,
  //         unthresholdedDarkCopy,
  //       ) as ndarray.NdArray<Uint8Array>;
  //       ops.ltseq(thresholdField, finetuneAction.threshold);
  //     } else {
  //       thresholdField = copyNdArray(
  //         Uint8Array,
  //         unthresholdedLightCopy,
  //       ) as ndarray.NdArray<Uint8Array>;
  //       ops.gtseq(thresholdField, finetuneAction.threshold);
  //     }

  //     processBinaryMaskInPlaceAndAttach(thresholdField, finetuneAction, quickSelectGeometry);
  //   } else if (cancel || escape) {
  //     sendAnalyticsEvent("cancelled_quick_select_preview");
  //     quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
  //     yield* call([Toast, Toast.close], TOAST_KEY);
  //     return;
  //   } else if (confirm || enter) {
  //     sendAnalyticsEvent("confirmed_quick_select_preview");

  //     yield* finalizeQuickSelect(
  //       quickSelectGeometry,
  //       volumeTracing,
  //       activeViewport,
  //       labeledResolution,
  //       embeddingBoxMag1,
  //       thirdDim,
  //       size,
  //       firstDim,
  //       secondDim,
  //       inputNdUvw,
  //       thresholdField,
  //       overwriteMode,
  //       labeledZoomStep,
  //     );
  //     yield* call([Toast, Toast.close], TOAST_KEY);
  //     yield* put(showQuickSelectSettingsAction(true));
  //     return;
  //   }
  // }
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
  output: ndarray.NdArray<Uint8Array>,
  quickSelectConfig: Omit<QuickSelectConfig, "showPreview">,
  quickSelectGeometry: QuickSelectGeometry,
) {
  fillHolesInPlace(output);
  morphology.close(output, quickSelectConfig.closeValue);
  morphology.erode(output, quickSelectConfig.erodeValue);
  morphology.dilate(output, quickSelectConfig.dilateValue);

  const outputRGBA = maskToRGBA(output);
  quickSelectGeometry.attachTextureMask(outputRGBA, output.shape[0], output.shape[1]);
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
  quickSelectGeometry: QuickSelectGeometry,
  volumeTracing: VolumeTracing,
  activeViewport: OrthoView,
  labeledResolution: Vector3,
  boundingBoxMag1: BoundingBox,
  thirdDim: number,
  size: Vector3,
  firstDim: number,
  secondDim: number,
  // inputNdUvw: ndarray.NdArray<TypedArrayWithoutBigInt>,
  output: ndarray.NdArray<TypedArrayWithoutBigInt>,
  overwriteMode: OverwriteMode,
  labeledZoomStep: number,
) {
  quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
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

  console.time("fill voxel buffer");
  for (let u = 0; u < size[firstDim]; u++) {
    for (let v = 0; v < size[secondDim]; v++) {
      if (output.get(u, v, 0) > 0) {
        voxelBuffer2D.setValue(u, v, 1);
      }
    }
  }
  console.timeEnd("fill voxel buffer");

  console.time("label with voxel buffer");
  yield* call(
    labelWithVoxelBuffer2D,
    voxelBuffer2D,
    ContourModeEnum.DRAW,
    overwriteMode,
    labeledZoomStep,
    activeViewport,
  );
  console.timeEnd("label with voxel buffer");
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
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

function maskToRGBA(output: ndarray.NdArray<Uint8Array>) {
  // Create an RGBA mask from the single-channel input, since this is needed
  // to create a texture for the rectangle preview.
  const channelCount = 4;
  const outputRGBA = new Uint8Array(output.size * channelCount);
  let idx = 0;

  const max = ops.sup(output);
  const min = ops.inf(output);

  const normalize =
    max === min
      ? // Avoid division by zero
        (val: number) => (val > 0 ? 255 : 0)
      : (val: number) => (255 * (val - min)) / (max - min);

  for (let v = 0; v < output.shape[1]; v++) {
    for (let u = 0; u < output.shape[0]; u++) {
      let val = normalize(output.get(u, v, 0));
      if (u === 0 || v === 0 || u === output.shape[0] - 1 || v === output.shape[1] - 1) {
        // Make border pixels always visible so that the user can recognize the
        // preview state better. These pixels are only painted in the preview texture
        // and won't be annotated when confirming the preview.
        val = 255;
      }
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

import _ from "lodash";
import ops from "ndarray-ops";
import moments from "ndarray-moments";
import {
  ContourModeEnum,
  OrthoView,
  OverwriteMode,
  TypedArray,
  TypedArrayWithoutBigInt,
  Vector2,
  Vector3,
} from "oxalis/constants";
import PriorityQueue from "js-priority-queue";

import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery, race, take } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  CancelWatershedAction,
  ComputeWatershedForRectAction,
  ConfirmWatershedAction,
  FineTuneWatershedAction,
  finishAnnotationStrokeAction,
  registerLabelPointAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import api from "oxalis/api/internal_api";
import ndarray from "ndarray";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import morphology from "ball-morphology";
import Toast from "libs/toast";
import { copyNdArray } from "./volume/volume_interpolation_saga";
import { EnterAction, EscapeAction, setIsWatershedActiveAction } from "../actions/ui_actions";
import { OxalisState, VolumeTracing } from "oxalis/store";
import { RectangleGeometry } from "oxalis/geometries/contourgeometry";
import {
  getColorLayers,
  getLayerBoundingBox,
  getResolutionInfo,
} from "../accessors/dataset_accessor";
import Dimensions from "../dimensions";
import { take2 } from "libs/utils";
import { getRequestLogZoomStep } from "../accessors/flycam_accessor";
import { updateUserSettingAction } from "../actions/settings_actions";

export default function* listenToMinCut(): Saga<void> {
  yield* takeEvery(
    "COMPUTE_WATERSHED_FOR_RECT",
    function* guard(action: ComputeWatershedForRectAction) {
      try {
        yield* put(setIsWatershedActiveAction(true));
        yield* call(performWatershed, action);
      } catch (ex) {
        Toast.error(JSON.stringify(ex as Error));
        console.error(ex);
      } finally {
        yield* put(setIsWatershedActiveAction(false));
      }
    },
  );
}

function* performWatershed(action: ComputeWatershedForRectAction): Saga<void> {
  const activeViewport = yield* select(
    (state: OxalisState) => state.viewModeData.plane.activeViewport,
  );
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const watershedConfig = yield* select((state) => state.userConfiguration.watershed);
  console.log("starting saga performWatershed");
  const { rectangleGeometry } = action;

  const colorLayers = yield* select((state: OxalisState) => getColorLayers(state.dataset));
  if (colorLayers.length === 0) {
    Toast.warning("No color layer available to use for watershed feature");
    return;
  }

  const colorLayer = colorLayers[0];

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

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  if (!volumeTracingLayer) {
    console.log("No volumeTracing available.");
    return;
  }

  const requestedZoomStep = yield* select((store) => getRequestLogZoomStep(store));
  const resolutionInfo = getResolutionInfo(colorLayer.resolutions);
  const labeledZoomStep = resolutionInfo.getClosestExistingIndex(requestedZoomStep);
  const labeledResolution = resolutionInfo.getResolutionByIndexOrThrow(labeledZoomStep);

  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(labeledResolution);

  console.log(`Loading data... (for ${boundingBoxTarget.getVolume()} vx)`);
  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    colorLayer.name,
    boundingBoxMag1,
    labeledZoomStep,
  );
  const size = boundingBoxTarget.getSize();
  const stride = [1, size[0], size[0] * size[1]];

  if (inputData instanceof BigUint64Array) {
    throw new Error("Color input layer must not be 64-bit.");
  }

  const inputNdUvw = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  const centerUV = take2(V3.floor(V3.scale(inputNdUvw.shape as Vector3, 0.5)));
  const rectCenterBrushExtentUV = V3.floor(V3.scale(inputNdUvw.shape as Vector3, 1 / 10));

  let output: ndarray.NdArray<TypedArrayWithoutBigInt> = ndarray(
    new Uint8Array(inputNdUvw.size),
    inputNdUvw.shape,
  );

  console.time("floodfill");

  const maxVisitedField = getDistanceField(inputNdUvw, centerUV, "max");
  const minVisitedField = getDistanceField(inputNdUvw, centerUV, "min");

  function getExtremeValueAtBorders(arr: ndarray.NdArray, mode: "min" | "max") {
    const fn = mode === "min" ? Math.min : Math.max;
    const opsFn = mode === "min" ? ops.inf : ops.sup;
    return fn(
      opsFn(arr.pick(null, 0, 0)),
      opsFn(arr.pick(null, arr.shape[1] - 1, 0)),
      opsFn(arr.pick(0, null, 0)),
      opsFn(arr.pick(arr.shape[0] - 1, null, 0)),
    );
  }

  const minThresholdAtBorder = getExtremeValueAtBorders(maxVisitedField, "min");
  const maxThresholdAtBorder = getExtremeValueAtBorders(minVisitedField, "max");
  const smallestThresh = ops.inf(maxVisitedField);
  const largestThresh = ops.sup(minVisitedField);

  const maxEffectiveThresh = Math.max(minThresholdAtBorder, smallestThresh + 1);
  const minEffectiveThresh = Math.min(maxThresholdAtBorder, largestThresh - 1);

  const [mean] = moments(1, inputNdUvw);
  const minIntensity = ops.sup(inputNdUvw);
  const maxIntensity = ops.inf(inputNdUvw);

  const distToCenterRect = V3.floor(
    V3.sub(V3.scale(inputNdUvw.shape as Vector3, 0.5), rectCenterBrushExtentUV),
  );
  const subview = inputNdUvw
    .lo(distToCenterRect[0], distToCenterRect[1], 0)
    .hi(distToCenterRect[0], distToCenterRect[1], 1);
  const [centerMean] = moments(1, subview);

  console.table({
    meanMoments: { value: mean },
    minIntensity: { value: minIntensity },
    maxIntensity: { value: maxIntensity },
    centerMean: { value: centerMean },
  });

  // const maxHistograms = computeHistogram(maxVisitedField);
  console.group("dark segment");
  console.log("minThresholdAtBorder", minThresholdAtBorder);
  console.log("smallestThresh", smallestThresh);
  console.log("maxEffectiveThresh", maxEffectiveThresh);
  // console.log("computeHistogram", maxHistograms);
  console.groupEnd();

  // const minHistograms = computeHistogram(minVisitedField);
  console.group("light segment");
  console.log("maxThresholdAtBorder", maxThresholdAtBorder);
  console.log("largestThresh", largestThresh);
  console.log("minEffectiveThresh", minEffectiveThresh);
  // console.log("computeHistogram", minHistograms);
  console.groupEnd();

  let visitedField;
  const unthresholdedDarkCopy = copyNdArray(Uint8Array, maxVisitedField);
  const unthresholdedLightCopy = copyNdArray(Uint8Array, minVisitedField);
  let initialDetectDarkSegment = centerMean < mean;

  if (initialDetectDarkSegment && maxEffectiveThresh > minThresholdAtBorder) {
    console.info("switch from detecting dark segment to detecting light segment");
    initialDetectDarkSegment = false;
  }
  if (!initialDetectDarkSegment && minEffectiveThresh < maxThresholdAtBorder) {
    console.info("switch from detecting light segment to detecting dark segment");
    initialDetectDarkSegment = true;
  }

  console.log(initialDetectDarkSegment ? "Select dark segment" : "Select light segment");
  if (initialDetectDarkSegment) {
    visitedField = maxVisitedField;
    ops.ltseq(visitedField, maxEffectiveThresh);
    yield* put(
      updateUserSettingAction("watershed", {
        ...watershedConfig,
        segmentMode: "dark",
        threshold: maxEffectiveThresh,
      }),
    );
  } else {
    visitedField = minVisitedField;
    ops.gtseq(visitedField, minEffectiveThresh);
    yield* put(
      updateUserSettingAction("watershed", {
        ...watershedConfig,
        segmentMode: "light",
        threshold: minEffectiveThresh,
      }),
    );
  }
  output = visitedField;

  console.log("visitedField", visitedField);
  console.log("output", output);
  // end

  const seedIntensity = inputNdUvw.get(
    Math.floor(inputNdUvw.shape[0] / 2),
    Math.floor(inputNdUvw.shape[1] / 2),
    0,
  );
  console.log({ seedIntensity });

  morphology.close(output, watershedConfig.closeValue);
  morphology.erode(output, watershedConfig.erodeValue);
  morphology.dilate(output, watershedConfig.dilateValue);
  console.timeEnd("floodfill");

  const outputRGBA = maskToRGBA(inputNdUvw, visitedField);
  rectangleGeometry.attachData(outputRGBA, inputNdUvw.shape[0], inputNdUvw.shape[1]);

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  if (!watershedConfig.showPreview) {
    return yield* finalizeWatershed(
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
      output,
      overwriteMode,
      labeledZoomStep,
    );
  }
  let newestOutput = output;

  while (true) {
    const { finetuneAction, cancelWatershedAction, escape, enter, confirm } = (yield* race({
      finetuneAction: take("FINE_TUNE_WATERSHED"),
      cancelWatershedAction: take("CANCEL_WATERSHED"),
      escape: take("ESCAPE"),
      enter: take("ENTER"),
      confirm: take("CONFIRM_WATERSHED"),
    })) as {
      finetuneAction: FineTuneWatershedAction;
      cancelWatershedAction: CancelWatershedAction;
      escape: EscapeAction;
      enter: EnterAction;
      confirm: ConfirmWatershedAction;
    };

    if (confirm || enter || cancelWatershedAction || escape) {
      console.log("terminate saga...");

      if (escape || cancelWatershedAction) {
        rectangleGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        console.log("...without brushing");
        return;
      }

      return yield* finalizeWatershed(
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
        newestOutput,
        overwriteMode,
        labeledZoomStep,
      );
    } else if (finetuneAction) {
      if (finetuneAction.segmentMode === "dark") {
        newestOutput = copyNdArray(
          Uint8Array,
          unthresholdedDarkCopy,
        ) as ndarray.NdArray<Uint8Array>;
        ops.ltseq(newestOutput, finetuneAction.threshold);
      } else {
        newestOutput = copyNdArray(
          Uint8Array,
          unthresholdedLightCopy,
        ) as ndarray.NdArray<Uint8Array>;
        ops.gtseq(newestOutput, finetuneAction.threshold);
      }

      morphology.close(newestOutput, finetuneAction.closeValue);
      morphology.erode(newestOutput, finetuneAction.erodeValue);
      morphology.dilate(newestOutput, finetuneAction.dilateValue);

      const outputRGBA = maskToRGBA(inputNdUvw, newestOutput);
      const { rectangleGeometry } = action;
      rectangleGeometry.attachData(outputRGBA, inputNdUvw.shape[0], inputNdUvw.shape[1]);
    }
  }
}

function* finalizeWatershed(
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
  console.log("...with brushing");
  const interpolationLayer = yield* call(
    createVolumeLayer,
    volumeTracing,
    activeViewport,
    labeledResolution,
    boundingBoxMag1.min[thirdDim],
  );
  const voxelBuffer2D = interpolationLayer.createVoxelBuffer2D(
    V2.floor(interpolationLayer.globalCoordToMag2DFloat(boundingBoxMag1.min)),
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
  return;
}

function maskToRGBA(inputNdUvw: ndarray.NdArray<TypedArray>, output: ndarray.NdArray) {
  const channelCount = 4;
  const outputRGBA = new Uint8Array(inputNdUvw.size * channelCount);
  let idx = 0;

  const max = ops.sup(output);
  const min = ops.inf(output);

  for (let v = 0; v < inputNdUvw.shape[1]; v++) {
    for (let u = 0; u < inputNdUvw.shape[0]; u++) {
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

function computeHistogram(arr: ndarray.NdArray<TypedArray>) {
  const hist: Record<number, number> = {};
  for (let u = 0; u < arr.shape[0]; u++) {
    for (let v = 0; v < arr.shape[1]; v++) {
      const val = Number(arr.get(u, v, 0));
      hist[val] = (hist[val] || 0) + 1;
    }
  }

  const cumsumHistLeft: Record<number, number> = {};
  let cumsum = 0;
  for (let i = 0; i < 256; i++) {
    cumsum += hist[i] || 0;
    cumsumHistLeft[i] = cumsum;
  }

  const cumsumHistRight: Record<number, number> = {};
  cumsum = 0;
  for (let i = 255; i >= 0; i--) {
    cumsum += hist[i] || 0;
    cumsumHistRight[i] = cumsum;
  }

  return { hist, cumsumHistLeft, cumsumHistRight };
}

type PriorityItem = {
  coords: Vector2;
  threshold: number;
};

function getDistanceField(
  inputNdUvw: ndarray.NdArray<TypedArrayWithoutBigInt>,
  centerUV: Vector2,
  mode: "min" | "max",
): ndarray.NdArray<TypedArrayWithoutBigInt> {
  const comparator =
    mode === "max"
      ? // small priorities take precedence
        (b: PriorityItem, a: PriorityItem) => b.threshold - a.threshold
      : // big priorities take precedence
        (b: PriorityItem, a: PriorityItem) => a.threshold - b.threshold;
  const queue = new PriorityQueue({
    comparator,
  });

  const visitedField = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);

  queue.queue({ coords: centerUV, threshold: Number(inputNdUvw.get(centerUV[0], centerUV[1], 0)) });
  const neighborOffsets = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];

  // extremeThreshold is either the min or maximum value
  // found until a given point in time.
  let extremeThreshold = mode === "max" ? 0 : Infinity;
  const extremeFn = mode === "max" ? Math.max : Math.min;
  while (queue.length > 0) {
    const { coords, threshold } = queue.dequeue();

    if (visitedField.get(coords[0], coords[1], 0) > 0) {
      continue;
    }

    extremeThreshold = extremeFn(threshold, extremeThreshold);

    visitedField.set(coords[0], coords[1], 0, extremeThreshold);

    for (const offset of neighborOffsets) {
      const newCoord = V2.add(coords, offset);
      if (
        newCoord[0] >= 0 &&
        newCoord[1] >= 0 &&
        newCoord[0] < inputNdUvw.shape[0] &&
        newCoord[1] < inputNdUvw.shape[1]
      ) {
        const newThreshold = Number(inputNdUvw.get(newCoord[0], newCoord[1], 0));
        queue.queue({
          coords: newCoord,
          threshold: newThreshold,
        });
      }
    }
  }
  return visitedField;
}

import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import {
  ContourModeEnum,
  OrthoView,
  OverwriteMode,
  TypedArray,
  Vector2,
  Vector3,
  Vector4,
} from "oxalis/constants";
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
import { takeEveryUnlessBusy } from "oxalis/model/sagas/saga_helpers";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import api from "oxalis/api/internal_api";
import ndarray, { NdArray } from "ndarray";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import morphology from "ball-morphology";
import floodFill from "n-dimensional-flood-fill";
import Toast from "libs/toast";
import { copyNdArray } from "./volume/volume_interpolation_saga";
import { EnterAction, EscapeAction } from "../actions/ui_actions";
import { OxalisState, VolumeTracing } from "oxalis/store";
import { RectangleGeometry } from "oxalis/geometries/contourgeometry";
import { getColorLayers } from "../accessors/dataset_accessor";
import Dimensions from "../dimensions";
import { take2 } from "libs/utils";

function takeLatest2(vec4: Vector4): Vector2 {
  return [vec4[2], vec4[3]];
}

function* performWatershed(action: ComputeWatershedForRectAction): Saga<void> {
  const activeViewport = yield* select(
    (state: OxalisState) => state.viewModeData.plane.activeViewport,
  );
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const watershedConfig = yield* select((state) => state.userConfiguration.watershed);
  console.log("starting saga performWatershed");

  const { startPosition, endPosition } = action;
  const boundingBoxObj = {
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  };

  const boundingBoxMag1 = new BoundingBox(boundingBoxObj);

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  if (!volumeTracingLayer) {
    console.log("No volumeTracing available.");
    return;
  }
  const resolutionIndex = 0;

  const targetMag: Vector3 = [1, 1, 1];
  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(targetMag);

  console.log(`Loading data... (for ${boundingBoxTarget.getVolume()} vx)`);
  const colorLayers = yield* select((state: OxalisState) => getColorLayers(state.dataset));
  if (colorLayers.length === 0) {
    Toast.warning("No color layer available to use for watershed feature");
    return;
  }

  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    colorLayers[0].name,
    boundingBoxMag1,
    resolutionIndex,
  );
  const size = boundingBoxMag1.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  const inputNdUvw = ndarray(inputData, size, stride).transpose(firstDim, secondDim, thirdDim);

  const centerUV = take2(V3.floor(V3.scale(inputNdUvw.shape as Vector3, 0.5)));
  const rectCenterBrushExtentUV = V3.floor(V3.scale(inputNdUvw.shape as Vector3, 1 / 10));

  for (
    let u = centerUV[0] - rectCenterBrushExtentUV[0];
    u < centerUV[0] + rectCenterBrushExtentUV[0];
    u++
  ) {
    for (
      let v = centerUV[1] - rectCenterBrushExtentUV[1];
      v < centerUV[1] + rectCenterBrushExtentUV[1];
      v++
    ) {
      inputNdUvw.set(u, v, 0, 255);
    }
  }

  const output = ndarray(new Uint8Array(inputNdUvw.size), inputNdUvw.shape);

  const labeledResolution = [1, 1, 1] as Vector3;
  const labeledZoomStep = 0;

  console.time("floodfill");
  floodFill({
    getter: (x: number, y: number, z: number) => {
      if (z != undefined) {
        throw new Error("Third dimension should not be used in floodfill. Is seed 2d?");
      }
      if (x < 0 || y < 0 || x > inputNdUvw.shape[0] || 1 > inputNdUvw.shape[1]) {
        return null;
      }
      return inputNdUvw.get(x, y, 0);
    },
    equals: (a: number, b: number) => {
      if (a == null || b == null) {
        return false;
      }
      return a > 128; // || Math.abs(a - b) / b < 0.1;
    },
    seed: centerUV,
    onFlood: (x: number, y: number) => {
      output.set(x, y, 0, 1);
    },
  });

  const seedIntensity = inputNdUvw.get(
    Math.floor(inputNdUvw.shape[0] / 2),
    Math.floor(inputNdUvw.shape[1] / 2),
    0,
  );
  console.log({ seedIntensity });

  const floodfillCopy = copyNdArray(Uint8Array, output);

  morphology.close(output, watershedConfig.closeValue);
  morphology.erode(output, watershedConfig.erodeValue);
  morphology.dilate(output, watershedConfig.dilateValue);
  // // morphology.dilate(output, 1);
  console.timeEnd("floodfill");

  const outputRGBA = maskToRGBA(inputNdUvw, output);
  const { rectangleGeometry } = action;
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
        output,
        overwriteMode,
        labeledZoomStep,
      );
    } else if (finetuneAction) {
      console.log("finetuneAction", finetuneAction);
      newestOutput = copyNdArray(Uint8Array, floodfillCopy) as ndarray.NdArray<Uint8Array>;

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
  inputNdUvw: ndarray.NdArray<TypedArray>,
  output: ndarray.NdArray<Uint8Array>,
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
  for (let v = 0; v < inputNdUvw.shape[1]; v++) {
    for (let u = 0; u < inputNdUvw.shape[0]; u++) {
      if (output.get(u, v, 0) > 0) {
        outputRGBA[idx] = 255;
        outputRGBA[idx + 1] = 255;
        outputRGBA[idx + 2] = 255;
        outputRGBA[idx + 3] = 255;
      } else {
        outputRGBA[idx] = 0;
        outputRGBA[idx + 1] = 0;
        outputRGBA[idx + 2] = 0;
        outputRGBA[idx + 3] = 0;
      }
      idx += channelCount;
    }
  }
  return outputRGBA;
}

export default function* listenToMinCut(): Saga<void> {
  // yield* takeEveryUnlessBusy(
  yield* takeEvery(
    "COMPUTE_WATERSHED_FOR_RECT",
    function* guard(action: ComputeWatershedForRectAction) {
      try {
        yield* call(performWatershed, action);
      } catch (ex) {
        Toast.error(ex as Error);
        console.error(ex);
      }
    },
    // "Watershed is being computed.",
  );
}

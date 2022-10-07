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
import { VolumeTracing } from "oxalis/store";
import { RectangleGeometry } from "oxalis/geometries/contourgeometry";

function takeLatest2(vec4: Vector4): Vector2 {
  return [vec4[2], vec4[3]];
}

function* performWatershed(action: ComputeWatershedForRectAction): Saga<void> {
  console.log("starting saga performWatershed");

  const { startPosition, endPosition } = action;
  const boundingBoxObj = {
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(V3.add(V3.max(startPosition, endPosition), [0, 0, 1])),
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
  const inputData = yield* call(
    [api.data, api.data.getDataForBoundingBox],
    "color",
    boundingBoxMag1,
    resolutionIndex,
  );
  const size = boundingBoxMag1.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  const inputNd = ndarray(inputData, size, stride);

  const center2D = [Math.floor(inputNd.shape[0] / 2), Math.floor(inputNd.shape[1] / 2)];
  const rectCenterBrushExtent = [
    Math.floor(inputNd.shape[0] / 10),
    Math.floor(inputNd.shape[1] / 10),
  ];

  for (
    let u = center2D[0] - rectCenterBrushExtent[0];
    u < center2D[0] + rectCenterBrushExtent[0];
    u++
  ) {
    for (
      let v = center2D[1] - rectCenterBrushExtent[1];
      v < center2D[1] + rectCenterBrushExtent[1];
      v++
    ) {
      inputNd.set(u, v, 0, 255);
    }
  }

  const output = ndarray(new Uint8Array(inputNd.size), inputNd.shape);

  const labeledResolution = [1, 1, 1] as Vector3;
  const labeledZoomStep = 0;
  const activeViewport: OrthoView = "PLANE_XY";
  const firstDim = 0;
  const secondDim = 1;
  const thirdDim = 2;

  console.time("floodfill");
  floodFill({
    getter: (x: number, y: number) => {
      if (x < 0 || y < 0 || x > inputNd.shape[0] || 1 > inputNd.shape[1]) {
        return null;
      }
      return inputNd.get(x, y, 0);
    },
    equals: (a: number, b: number) => {
      if (a == null || b == null) {
        return false;
      }
      return a > 128; // || Math.abs(a - b) / b < 0.1;
    },
    seed: center2D,
    onFlood: (x: number, y: number) => {
      output.set(x, y, 0, 1);
    },
  });

  const seedIntensity = inputNd.get(
    Math.floor(inputNd.shape[0] / 2),
    Math.floor(inputNd.shape[1] / 2),
    0,
  );
  console.log({ seedIntensity });

  const floodfillCopy = copyNdArray(Uint8Array, output);

  morphology.close(output, 6);
  morphology.erode(output, 3);
  morphology.dilate(output, 6);
  // // morphology.dilate(output, 1);
  console.timeEnd("floodfill");

  const outputRGBA = maskToRGBA(inputNd, output);
  const { rectangleGeometry } = action;
  rectangleGeometry.attachData(outputRGBA, inputNd.shape[0], inputNd.shape[1]);

  let newestOutput = output;

  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);
  if (!action.show_preview_first) {
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
      inputNd,
      output,
      overwriteMode,
      labeledZoomStep,
    );
  }

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
        inputNd,
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

      const outputRGBA = maskToRGBA(inputNd, newestOutput);
      const { rectangleGeometry } = action;
      rectangleGeometry.attachData(outputRGBA, inputNd.shape[0], inputNd.shape[1]);
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
  inputNd: ndarray.NdArray<TypedArray>,
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

  for (let u = 0; u < inputNd.shape[0]; u++) {
    for (let v = 0; v < inputNd.shape[1]; v++) {
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

function maskToRGBA(inputNd: ndarray.NdArray<TypedArray>, output: ndarray.NdArray) {
  const channelCount = 4;
  const outputRGBA = new Uint8Array(inputNd.size * channelCount);
  let idx = 0;
  for (let v = 0; v < inputNd.shape[1]; v++) {
    for (let u = 0; u < inputNd.shape[0]; u++) {
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

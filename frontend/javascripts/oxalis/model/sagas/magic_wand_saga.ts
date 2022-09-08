import _ from "lodash";
import type { Action } from "oxalis/model/actions/actions";
import {
  BoundingBoxType,
  ContourModeEnum,
  TypedArray,
  Vector2,
  Vector3,
  Vector4,
} from "oxalis/constants";
import type { MutableNode, Node } from "oxalis/store";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import {
  enforceActiveVolumeTracing,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { finishAnnotationStrokeAction } from "oxalis/model/actions/volumetracing_actions";
import { getResolutionInfo, ResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { takeEveryUnlessBusy } from "oxalis/model/sagas/saga_helpers";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import createProgressCallback from "libs/progress_callback";
import api from "oxalis/api/internal_api";
import window from "libs/window";
import { APISegmentationLayer } from "types/api_flow_types";
import ndarray, { NdArray } from "ndarray";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import Dimensions from "../dimensions";
// const ort = require("onnxruntime-web");

// By default, a new bounding box is created around
// the seed nodes with a padding. Within the bounding box
// the min-cut is computed.
const DEFAULT_PADDING: Vector3 = [50, 50, 50];
// Voxels which are close to the seeds must not be relabeled.
// Otherwise, trivial min-cuts are performed which cut right
// around one seed.
// This distance is specified in voxels of the current mag (i.e.,
// a distance of 30 vx should be respected) and does not need scaling
// to another mag.
// For seeds that are very close to each other, their distance
// overrides this threshold.
const MIN_DIST_TO_SEED = 30;
const TimeoutError = new Error("Timeout");
const PartitionFailedError = new Error(
  "Segmentation could not be partioned. Zero edges removed in last iteration. Probably due to nodes being too close to each other? Aborting...",
);
// If the min-cut does not succeed after 10 seconds
// in the selected mag, the next mag is tried.
const MIN_CUT_TIMEOUT = 10 * 1000; // 10 seconds

// During the refinement phase, the timeout is more forgiving.
// Even if the refinement is slow, we typically don't want to
// abort it, since the initial min-cut has already been performed.
// Note that the timeout is used for each refining min-cut phase.
const MIN_CUT_TIMEOUT_REFINEMENT = 30 * 1000; // 30 seconds

// To choose the initial mag, a voxel threshold is defined
// as a heuristic. This avoids that an unrealistic mag
// is tried in the first place.
// 2 MV corresponds to ~8MB for uint32 data.
const VOXEL_THRESHOLD = 2000000;
// The first magnification is always ignored initially as a performance
// optimization (unless it's the only existent mag).
const ALWAYS_IGNORE_FIRST_MAG_INITIALLY = true;

const EXPECTED_INPUT_SHAPE: Vector4 = [1, 4, 58, 58];
const OUTPUT_SHAPE: Vector4 = [1, 1, 26, 26];
const OUTPUT_SIZE = OUTPUT_SHAPE.reduce((agg, val) => agg * val, 1);

function takeLatest2(vec4: Vector4): Vector2 {
  return [vec4[2], vec4[3]];
}

function selectAppropriateResolutions(
  boundingBoxMag1: BoundingBox,
  resolutionInfo: ResolutionInfo,
): Array<[number, Vector3]> {
  const resolutionsWithIndices = resolutionInfo.getResolutionsWithIndices();
  const appropriateResolutions: Array<[number, Vector3]> = [];

  for (const [resolutionIndex, resolution] of resolutionsWithIndices) {
    if (
      resolutionIndex === 0 &&
      resolutionsWithIndices.length > 1 &&
      ALWAYS_IGNORE_FIRST_MAG_INITIALLY
    ) {
      // Don't consider Mag 1, as it's usually too fine-granular
      continue;
    }

    const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(resolution);

    if (boundingBoxTarget.getVolume() < VOXEL_THRESHOLD) {
      appropriateResolutions.push([resolutionIndex, resolution]);
    }
  }

  return appropriateResolutions;
}

type L = (x: number, y: number, z: number) => number;
type LL = (vec: Vector3) => number;

function* performMagicWand(action: Action): Saga<void> {
  // @ts-ignore
  if (action.type !== "MAGIC_WAND_FOR_RECT") {
    throw new Error("Satisfy typescript.");
  }

  // const session = yield ort.InferenceSession.create("/public/ml-models/FFN.onnx");
  // console.log(session);
  // const results = yield* session.run(input);

  const { startPosition, endPosition } = action;
  const boundingBoxObj = {
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(V3.add(V3.max(startPosition, endPosition), [0, 0, 1])),
  };

  const unpaddedBoundingBoxMag1 = new BoundingBox(boundingBoxObj);
  const boundingBoxMag1 = unpaddedBoundingBoxMag1.paddedWithMargins([16, 16, 0]);

  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  const volumeTracing = yield* select(enforceActiveVolumeTracing);

  if (!volumeTracingLayer) {
    console.log("No volumeTracing available.");
    return;
  }

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  const appropriateResolutionInfos = selectAppropriateResolutions(boundingBoxMag1, resolutionInfo);
  const resolutionIndex = 0;

  const targetMag: Vector3 = [1, 1, 1];
  const targetMagString = `${targetMag.join(",")}`;
  const boundingBoxTarget = boundingBoxMag1.fromMag1ToMag(targetMag);
  const globalSeedA = V3.fromMag1ToMag(startPosition, targetMag);
  const globalSeedB = V3.fromMag1ToMag(endPosition, targetMag);
  const minDistToSeed = Math.min(V3.length(V3.sub(globalSeedA, globalSeedB)) / 2, MIN_DIST_TO_SEED);
  console.log("Setting minDistToSeed to ", minDistToSeed);
  const seedA = V3.sub(globalSeedA, boundingBoxTarget.min);
  const seedB = V3.sub(globalSeedB, boundingBoxTarget.min);
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

  const output = ndarray(new Uint8Array(inputNd.size), inputNd.shape);

  const labeledResolution = [1, 1, 1];
  const labeledZoomStep = 0;
  const activeViewport = "PLANE_XY";
  const firstDim = 0;
  const secondDim = 1;
  const thirdDim = 2;
  const transpose = (vector: Vector3) => Dimensions.transDim(vector, activeViewport);
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

  const USE_SIMPLE_HEURISTIC = false;
  if (USE_SIMPLE_HEURISTIC) {
    for (let u = 0; u < inputNd.shape[0]; u++) {
      for (let v = 0; v < inputNd.shape[1]; v++) {
        if (inputNd.get(u, v, 0) > 128) {
          output.set(u, v, 0, 1);
          voxelBuffer2D.setValue(u, v, 1);
        }
      }
    }
  } else {
    const { min, max } = boundingBoxMag1;
    const center = V3.floor(V3.scale(V3.add(min, max), 0.5));
    const margin2D = V2.scale(takeLatest2(EXPECTED_INPUT_SHAPE), 0.5);

    // todo: off-by-one error ?
    const marginLeft: Vector3 = [margin2D[0], margin2D[1], 0];
    const marginRight: Vector3 = [margin2D[0], margin2D[1], 1];
    const inputCutoutBBox = new BoundingBox({ min: center, max: center }).paddedWithMargins(
      marginLeft,
      marginRight,
    );
  }

  const overwriteMode = yield* select((state) => state.userConfiguration.overwriteMode);

  yield* call(
    labelWithVoxelBuffer2D,
    voxelBuffer2D,
    ContourModeEnum.DRAW,
    overwriteMode,
    labeledZoomStep,
    activeViewport,
  );
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
}

function mockedPredict(input: NdArray) {
  // - stride is 8
  // - input shape (1, 4, 58, 58)
  //     - graustufe, predicted_mask, gt_mask, distance_gt_mask
  // - output shape (1, 1, 26, 26)
  // - predicted_mask ist initialisiert mit nullen außer am mittelpunkt (1)
  if (!_.isEqual(input.shape, EXPECTED_INPUT_SHAPE)) {
    throw new Error(`Did not expect input shape: ${input.shape}`);
  }

  const output = ndarray(new Uint8Array(OUTPUT_SIZE), OUTPUT_SHAPE);

  for (let u = 0; u < OUTPUT_SHAPE[0] / 2; u++) {
    for (let v = 0; v < OUTPUT_SHAPE[1]; v++) {
      output.set(0, 0, u, v, 1);
    }
  }

  return output;
}

function isPositionOutside(position: Vector3, size: Vector3) {
  return (
    position[0] < 0 ||
    position[1] < 0 ||
    position[2] < 0 ||
    position[0] >= size[0] ||
    position[1] >= size[1] ||
    position[2] >= size[2]
  );
}

export default function* listenToMinCut(): Saga<void> {
  yield* takeEveryUnlessBusy("MAGIC_WAND_FOR_RECT", performMagicWand, "Min-cut is being computed.");
}

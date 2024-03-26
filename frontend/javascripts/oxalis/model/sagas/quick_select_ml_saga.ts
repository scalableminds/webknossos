import _ from "lodash";
import { BoundingBoxType, OrthoView, Vector2, Vector3 } from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V3 } from "libs/mjs";
import {
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import ndarray from "ndarray";
import Toast from "libs/toast";
import { OxalisState } from "oxalis/store";
import { map3 } from "libs/utils";
import { AdditionalCoordinate, APIDataset } from "types/api_flow_types";
import { getSamEmbedding, sendAnalyticsEvent } from "admin/admin_rest_api";
import Dimensions from "../dimensions";
import type { InferenceSession } from "onnxruntime-web";
import { finalizeQuickSelect, prepareQuickSelect } from "./quick_select_heuristic_saga";

export const EMBEDDING_SIZE = [1024, 1024, 0] as Vector3;
type CacheEntry = {
  embeddingPromise: Promise<Float32Array>;
  embeddingBoxMag1: BoundingBox;
  mag: Vector3;
  layerName: string;
};
export type SAMNodeSelect = {
  nodePositions: Vector3[];
  bounds: BoundingBoxType;
  viewport: OrthoView;
  predictionFinishedCallback: () => Saga<void>;
};
const MAXIMUM_CACHE_SIZE = 5;
// Sorted from most recently to least recently used.
let embeddingCache: Array<CacheEntry> = [];

function removeEmbeddingPromiseFromCache(embeddingPromise: Promise<Float32Array>) {
  embeddingCache = embeddingCache.filter((entry) => entry.embeddingPromise !== embeddingPromise);
}

function getEmbedding(
  dataset: APIDataset,
  layerName: string,
  userBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: Vector2 | null,
): CacheEntry {
  if (userBoxMag1.getVolume() === 0) {
    throw new Error("User bounding box should not have empty volume.");
  }
  const matchingCacheEntry = embeddingCache.find(
    (entry) =>
      entry.embeddingBoxMag1.containsBoundingBox(userBoxMag1) &&
      V3.equals(entry.mag, mag) &&
      entry.layerName === layerName,
  );
  if (matchingCacheEntry) {
    // Move entry to the front.
    embeddingCache = [
      matchingCacheEntry,
      ...embeddingCache.filter((el) => el !== matchingCacheEntry),
    ];
    console.debug("Use", matchingCacheEntry, "from cache.");
    return matchingCacheEntry;
  } else {
    const embeddingCenter = V3.round(userBoxMag1.getCenter());
    const sizeInMag1 = V3.scale3(Dimensions.transDim(EMBEDDING_SIZE, activeViewport), mag);
    const embeddingTopLeft = V3.alignWithMag(
      V3.sub(embeddingCenter, V3.scale(sizeInMag1, 0.5)),
      mag,
    );
    // Effectively, zero the first and second dimension in the mag.
    const depthSummand = V3.scale3(mag, Dimensions.transDim([0, 0, 1], activeViewport));
    const embeddingBottomRight = V3.add(embeddingTopLeft, sizeInMag1);
    const embeddingBoxMag1 = new BoundingBox({
      min: embeddingTopLeft,
      max: V3.add(embeddingBottomRight, depthSummand),
    });

    if (!embeddingBoxMag1.containsBoundingBox(userBoxMag1)) {
      // This is unlikely as the embedding size of 1024**2 is quite large.
      // The UX can certainly be optimized in case users run into this problem
      // more often.
      throw new Error("Selected bounding box is too large for AI selection.");
    }

    const embeddingPromise = getSamEmbedding(
      dataset,
      layerName,
      mag,
      embeddingBoxMag1,
      additionalCoordinates,
      intensityRange,
    );

    const newEntry = { embeddingPromise, embeddingBoxMag1, mag, layerName };
    embeddingCache = [newEntry, ...embeddingCache.slice(0, MAXIMUM_CACHE_SIZE - 1)];

    return newEntry;
  }
}

let session: Promise<InferenceSession> | null;

export async function getInferenceSession() {
  const ort = await import("onnxruntime-web");
  if (session == null) {
    session = ort.InferenceSession.create(
      "/assets/models/vit_l_0b3195_decoder_quantized_multi_mask.onnx",
    );
  }
  return session;
}

async function inferFromEmbedding(
  embedding: Float32Array,
  embeddingBoxInTargetMag: BoundingBox,
  userBoxInTargetMag: BoundingBox,
  nodePositions: Vector3[] | null,
  activeViewport: OrthoView,
) {
  const [firstDim, secondDim, _thirdDim] = Dimensions.getIndices(activeViewport);
  const shouldDetectRectangle = nodePositions == null;
  const ort = await import("onnxruntime-web");

  let ortSession: InferenceSession;
  try {
    ortSession = await getInferenceSession();
  } catch (exception) {
    console.error(exception);
    return null;
  }

  // Somewhere between the front-end, the back-end and the embedding
  // server, there seems to be a different linearization of the 2D image
  // data which is why the code here deals with the YZ plane as a special
  // case.
  const maybeAdjustedFirstDim = activeViewport === "PLANE_YZ" ? secondDim : firstDim;
  const maybeAdjustedSecondDim = activeViewport === "PLANE_YZ" ? firstDim : secondDim;
  const topLeft = V3.sub(userBoxInTargetMag.min, embeddingBoxInTargetMag.min);
  const bottomRight = V3.sub(userBoxInTargetMag.max, embeddingBoxInTargetMag.min);
  let onnxCoord;
  if (shouldDetectRectangle) {
    onnxCoord = new Float32Array([
      topLeft[maybeAdjustedFirstDim],
      topLeft[maybeAdjustedSecondDim],
      bottomRight[maybeAdjustedFirstDim],
      bottomRight[maybeAdjustedSecondDim],
    ]);
  } else {
    const nodePositionsInEmbedding = nodePositions.map((position) => {
      return [
        position[maybeAdjustedFirstDim] - embeddingBoxInTargetMag.min[maybeAdjustedFirstDim],
        position[maybeAdjustedSecondDim] - embeddingBoxInTargetMag.min[maybeAdjustedSecondDim],
      ];
    });
    onnxCoord = new Float32Array([..._.flatten(nodePositionsInEmbedding), 0, 0]);
  }

  // Inspired by https://github.com/facebookresearch/segment-anything/blob/main/notebooks/onnx_model_example.ipynb
  const onnxLabel = shouldDetectRectangle
    ? new Float32Array([2, 3])
    : new Float32Array([...new Array(nodePositions.length).fill(1), -1]);
  const onnxMaskInput = new Float32Array(256 * 256);
  const onnxHasMaskInput = new Float32Array([0]);
  const origImSize = new Float32Array([1024, 1024]);
  const ortInputs = {
    image_embeddings: new ort.Tensor("float32", embedding, [1, 256, 64, 64]),
    point_coords: new ort.Tensor("float32", onnxCoord, [1, Math.round(onnxCoord.length / 2), 2]),
    point_labels: new ort.Tensor("float32", onnxLabel, [1, onnxLabel.length]),
    mask_input: new ort.Tensor("float32", onnxMaskInput, [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", onnxHasMaskInput, [1]),
    orig_im_size: new ort.Tensor("float32", origImSize, [2]),
  };

  // Use intersection-over-union estimates to pick the best mask.
  const { masks, iou_predictions: iouPredictions } = await ortSession.run(ortInputs);
  const sortedScores: Array<[number, number]> = ([...iouPredictions.data] as number[])
    .map((score, index) => [score, index] as [number, number])
    .sort((a, b) => b[0] - a[0]);
  // Avoid picking prediction 3 as this seems to always select the full user bounding box.
  const bestMaskIndex = sortedScores[0][1] !== 3 ? sortedScores[0][1] : sortedScores[1][1];
  // @ts-ignore
  // const bestMaskIndex = iouPredictions.data.indexOf(Math.max(...iouPredictions.data));
  // const bestMaskIndex = 1;
  console.log("bestIndex", bestMaskIndex);
  const maskData = new Uint8Array(EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]);
  // Fill the mask data with a for loop (slicing/mapping would incur additional
  // data copies).
  const fullMaskThreshold = userBoxInTargetMag.getVolume() * 0.95;
  let markedVoxelCount = 0;
  const startOffset = bestMaskIndex * EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1];
  for (let idx = 0; idx < EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]; idx++) {
    maskData[idx] = (masks.data[idx + startOffset] as number) > 0 ? 1 : 0;
    markedVoxelCount += maskData[idx];
  }
  console.log("markedVoxelCount", markedVoxelCount);
  console.log("fullMaskThreshold", fullMaskThreshold);
  console.log("markedVoxelCount > fullMaskThreshold", markedVoxelCount > fullMaskThreshold);
  console.log();

  const size = embeddingBoxInTargetMag.getSize();
  const userSizeInTargetMag = userBoxInTargetMag.getSize();
  // Somewhere between the front-end, the back-end and the embedding
  // server, there seems to be a different linearization of the 2D image
  // data which is why the code here deals with the XZ plane as a special
  // case.
  const stride =
    activeViewport === "PLANE_XZ"
      ? [size[1], size[0], size[0] * size[1] * size[2]]
      : [size[2], size[0], size[0] * size[1] * size[2]];

  let mask = ndarray(maskData, size, stride);
  mask = mask
    // a.lo(x,y) => a[x:, y:]
    .lo(topLeft[firstDim], topLeft[secondDim], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(userSizeInTargetMag[firstDim], userSizeInTargetMag[secondDim], 1);
  return mask;
}

export function* prefetchEmbedding(action: MaybePrefetchEmbeddingAction) {
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const { labeledResolution, activeViewport, colorLayer } = preparation;
  const { startPosition } = action;
  const PREFETCH_WINDOW_SIZE = [100, 100, 0] as Vector3;
  const endPosition = V3.add(
    startPosition,
    Dimensions.transDim(PREFETCH_WINDOW_SIZE, activeViewport),
  );

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(labeledResolution, Dimensions.transDim([0, 0, 1], activeViewport));
  const alignedUserBoxMag1 = new BoundingBox({
    min: V3.floor(startPosition),
    max: V3.floor(V3.add(endPosition, depthSummand)),
  }).alignWithMag(labeledResolution, "floor");

  const dataset = yield* select((state: OxalisState) => state.dataset);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const { intensityRange } = layerConfiguration;

  try {
    // Won't block, because the return value is not a promise (but contains
    // a promise instead)
    const { embeddingPromise } = yield* call(
      getEmbedding,
      dataset,
      colorLayer.name,
      alignedUserBoxMag1,
      labeledResolution,
      activeViewport,
      additionalCoordinates || [],
      colorLayer.elementClass === "uint8" ? null : intensityRange,
    );
    // Also prefetch session (will block). After the first time, it's basically
    // a noop.
    yield* call(getInferenceSession);

    // Await the promise here so that the saga finishes once the embedding was loaded
    // (this simplifies debugging and time measurement).
    yield embeddingPromise;
  } catch (exception) {
    console.error(exception);
    // Don't notify user because we are only prefetching.
  }
}

export default function* performQuickSelect(
  action: ComputeQuickSelectForRectAction | SAMNodeSelect,
): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (additionalCoordinates && additionalCoordinates.length > 0) {
    Toast.warning(
      `Quick select with AI might produce unexpected results for ${
        3 + additionalCoordinates.length
      }D datasets.`,
    );
  }

  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const {
    labeledZoomStep,
    labeledResolution,
    firstDim,
    secondDim,
    thirdDim,
    activeViewport,
    volumeTracing,
    colorLayer,
  } = preparation;
  const { startPosition, endPosition } =
    "startPosition" in action
      ? action
      : { startPosition: action.bounds.min, endPosition: action.bounds.max };
  const quickSelectGeometry = "type" in action ? action.quickSelectGeometry : null;
  const nodePositions = "nodePositions" in action ? action.nodePositions : null;
  const isSamNodeSelect = "nodePositions" in action;
  const closeVolumeUndoBatchAfterPrediction = !isSamNodeSelect;
  const predictionFinishedCallback =
    "predictionFinishedCallback" in action ? action.predictionFinishedCallback : null;

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(labeledResolution, Dimensions.transDim([0, 0, 1], activeViewport));
  const unalignedUserBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(V3.add(V3.max(startPosition, endPosition), depthSummand)),
  });
  // Ensure that the third dimension is inclusive (otherwise, the center of the passed
  // coordinates wouldn't be exactly on the W plane on which the user started this action).
  const inclusiveMaxW = map3(
    (el, idx) => (idx === thirdDim ? el - 1 : el),
    unalignedUserBoxMag1.max,
  );
  if (quickSelectGeometry) {
    quickSelectGeometry.setCoordinates(unalignedUserBoxMag1.min, inclusiveMaxW);
  }

  const alignedUserBoxMag1 = unalignedUserBoxMag1.alignWithMag(labeledResolution, "floor");
  const dataset = yield* select((state: OxalisState) => state.dataset);
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const { intensityRange } = layerConfiguration;

  const { embeddingPromise, embeddingBoxMag1 } = yield* call(
    getEmbedding,
    dataset,
    colorLayer.name,
    alignedUserBoxMag1,
    labeledResolution,
    activeViewport,
    additionalCoordinates || [],
    colorLayer.elementClass === "uint8" ? null : intensityRange,
  );
  let embedding: Float32Array;
  try {
    embedding = yield embeddingPromise;
  } catch (exception) {
    console.error(exception);
    removeEmbeddingPromiseFromCache(embeddingPromise);
    throw new Error("Could not load embedding. See console for details.");
  }

  const embeddingBoxInTargetMag = embeddingBoxMag1.fromMag1ToMag(labeledResolution);
  const userBoxInTargetMag = alignedUserBoxMag1.fromMag1ToMag(labeledResolution);

  if (embeddingBoxInTargetMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  const mask = yield* call(
    inferFromEmbedding,
    embedding,
    embeddingBoxInTargetMag,
    userBoxInTargetMag,
    nodePositions,
    activeViewport,
  );
  if (!mask) {
    Toast.error("Could not infer mask. See console for details.");
    return;
  }

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  sendAnalyticsEvent("used_quick_select_with_ai");
  if (predictionFinishedCallback) {
    yield* predictionFinishedCallback();
  }
  yield* finalizeQuickSelect(
    quickSelectGeometry,
    volumeTracing,
    activeViewport,
    labeledResolution,
    alignedUserBoxMag1,
    thirdDim,
    userBoxInTargetMag.getSize(),
    firstDim,
    secondDim,
    mask,
    overwriteMode,
    labeledZoomStep,
    closeVolumeUndoBatchAfterPrediction,
  );
}

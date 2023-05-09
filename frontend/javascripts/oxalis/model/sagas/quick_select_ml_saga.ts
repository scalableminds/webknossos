import _ from "lodash";
import * as ort from "onnxruntime-web";
import { OrthoView, Vector3 } from "oxalis/constants";
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
import { APIDataset } from "types/api_flow_types";
import { getSamEmbedding, sendAnalyticsEvent } from "admin/admin_rest_api";
import Dimensions from "../dimensions";
import { InferenceSession } from "onnxruntime-web";
import { finalizeQuickSelect, prepareQuickSelect } from "./quick_select_heuristic_saga";

const EMBEDDING_SIZE = [1024, 1024, 0] as Vector3;
type CacheEntry = { embeddingPromise: Promise<Float32Array>; bbox: BoundingBox; mag: Vector3 };
const MAXIMUM_CACHE_SIZE = 5;
// Sorted from most recently to least recently used.
let embeddingCache: Array<CacheEntry> = [];

function getEmbedding(
  dataset: APIDataset,
  boundingBox: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
): CacheEntry {
  const matchingCacheEntry = embeddingCache.find(
    (entry) => entry.bbox.containsBoundingBox(boundingBox) && V3.equals(entry.mag, mag),
  );
  if (matchingCacheEntry) {
    // Move entry to the front.
    embeddingCache = [
      matchingCacheEntry,
      ...embeddingCache.filter((el) => el !== matchingCacheEntry).slice(0, MAXIMUM_CACHE_SIZE - 1),
    ];
    console.log("Use", matchingCacheEntry, "from cache.");
    return matchingCacheEntry;
  } else {
    try {
      const embeddingCenter = V3.round(boundingBox.getCenter());
      const sizeInMag1 = V3.scale3(Dimensions.transDim(EMBEDDING_SIZE, activeViewport), mag);
      const embeddingTopLeft = V3.sub(embeddingCenter, V3.scale(sizeInMag1, 0.5));
      const embeddingBottomRight = V3.add(embeddingTopLeft, sizeInMag1);
      const embeddingBoxMag1 = new BoundingBox({
        min: V3.floor(V3.min(embeddingTopLeft, embeddingBottomRight)),
        max: V3.floor(
          V3.add(
            V3.max(embeddingTopLeft, embeddingBottomRight),
            Dimensions.transDim([0, 0, 1], activeViewport),
          ),
        ),
      });
      console.log("Load new embedding for ", embeddingBoxMag1);

      const embeddingPromise = getSamEmbedding(dataset, mag, embeddingBoxMag1);

      const newEntry = { embeddingPromise, bbox: embeddingBoxMag1, mag };
      embeddingCache.unshift(newEntry);
      return newEntry;
    } catch (exception) {
      console.error(exception);
      throw new Error("Could not load embedding. See console for details.");
    }
  }
}

let session: Promise<InferenceSession> | null;

async function getSession() {
  if (session == null) {
    console.time("getSession");
    session = ort.InferenceSession.create("/assets/models/vit_l_0b3195_decoder_quantized.onnx");
    console.timeEnd("getSession");
  }
  return session;
}

async function inferFromEmbedding(
  embedding: Float32Array,
  embeddingBoxInTargetMag: BoundingBox,
  userBoxInTargetMag: BoundingBox,
  activeViewport: OrthoView,
) {
  const [firstDim, secondDim, _thirdDim] = Dimensions.getIndices(activeViewport);
  const topLeft = V3.sub(userBoxInTargetMag.min, embeddingBoxInTargetMag.min);
  const bottomRight = V3.sub(userBoxInTargetMag.max, embeddingBoxInTargetMag.min);

  const ort_session = await getSession();
  const onnx_coord = new Float32Array([
    topLeft[firstDim],
    topLeft[secondDim],
    bottomRight[firstDim],
    bottomRight[secondDim],
  ]);
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

  // @ts-ignore
  const thresholdFieldData = new Uint8Array(thresholded_mask);

  const size = embeddingBoxInTargetMag.getSize();
  const userSizeInTargetMag = userBoxInTargetMag.getSize();
  // Somewhere between the front-end, the back-end and the embedding
  // server, there seems to be a different linearization of 2D the image
  // data which is why the code here deals with the XZ plane as a special
  // case.
  const stride =
    activeViewport === "PLANE_XZ"
      ? [size[1], size[0], size[0] * size[1] * size[2]]
      : [size[2], size[0], size[0] * size[1] * size[2]];

  let thresholdField = ndarray(thresholdFieldData, size, stride);
  thresholdField = thresholdField
    // a.lo(x,y) => a[x:, y:]
    .lo(topLeft[firstDim], topLeft[secondDim], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(userSizeInTargetMag[firstDim], userSizeInTargetMag[secondDim], 1);
  return thresholdField;
}

export function* prefetchEmbedding(action: MaybePrefetchEmbeddingAction) {
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const { labeledResolution, activeViewport } = preparation;
  const { startPosition } = action;
  const PREFETCH_WINDOW_SIZE = [100, 100, 0] as Vector3;
  const endPosition = V3.add(
    startPosition,
    Dimensions.transDim(PREFETCH_WINDOW_SIZE, activeViewport),
  );

  const userBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  });

  console.time("prefetch session and embedding");
  const dataset = yield* select((state: OxalisState) => state.dataset);
  // Won't block, because the return value is not a promise (but contains
  // a promise instead)
  const { embeddingPromise } = yield* call(
    getEmbedding,
    dataset,
    userBoxMag1,
    labeledResolution,
    activeViewport,
  );
  // Also prefetch session (will block). After the first time, it's basically
  // a noop.
  yield* call(getSession);

  // Await the promise here so that the saga finishes once the embedding was loaded
  // (this simplifies debugging and time measurement).
  yield* call(() => embeddingPromise);
  console.timeEnd("prefetch session and embedding");
}

export default function* performQuickSelect(action: ComputeQuickSelectForRectAction): Saga<void> {
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
  } = preparation;
  const { startPosition, endPosition, quickSelectGeometry } = action;

  const userBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  });

  // Ensure that the third dimension is inclusive (otherwise, the center of the passed
  // coordinates wouldn't be exactly on the W plane on which the user started this action).
  const inclusiveMaxW = map3((el, idx) => (idx === thirdDim ? el - 1 : el), userBoxMag1.max);
  quickSelectGeometry.setCoordinates(userBoxMag1.min, inclusiveMaxW);

  console.time("getEmbedding");
  const dataset = yield* select((state: OxalisState) => state.dataset);
  const { embeddingPromise, bbox: embeddingBoxMag1 } = yield* call(
    getEmbedding,
    dataset,
    userBoxMag1,
    labeledResolution,
    activeViewport,
  );
  const embedding = yield* call(() => embeddingPromise);
  console.timeEnd("getEmbedding");

  const embeddingBoxInTargetMag = embeddingBoxMag1.fromMag1ToMag(labeledResolution);
  const userBoxInTargetMag = userBoxMag1.fromMag1ToMag(labeledResolution);

  if (embeddingBoxInTargetMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  console.time("infer");
  let thresholdField = yield* call(
    inferFromEmbedding,
    embedding,
    embeddingBoxInTargetMag,
    userBoxInTargetMag,
    activeViewport,
  );
  console.timeEnd("infer");

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

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
    thresholdField,
    overwriteMode,
    labeledZoomStep,
  );
}

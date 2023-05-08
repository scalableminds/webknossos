import _ from "lodash";
import * as ort from "onnxruntime-web";

import {
  ContourModeEnum,
  OrthoView,
  OverwriteMode,
  TypedArrayWithoutBigInt,
  Vector3,
} from "oxalis/constants";
import ErrorHandling from "libs/error_handling";

import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, put, takeEvery } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import {
  getActiveSegmentationTracing,
  getSegmentationLayerForTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  ComputeQuickSelectForRectAction,
  finishAnnotationStrokeAction,
  registerLabelPointAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import ndarray from "ndarray";
import Toast from "libs/toast";
import { OxalisState, VolumeTracing } from "oxalis/store";
import { QuickSelectGeometry } from "oxalis/geometries/helper_geometries";
import { map3 } from "libs/utils";
import { APIDataset } from "types/api_flow_types";
import { sendAnalyticsEvent } from "admin/admin_rest_api";
import { createVolumeLayer, labelWithVoxelBuffer2D } from "./volume/helpers";
import { setBusyBlockingInfoAction, setIsQuickSelectActiveAction } from "../actions/ui_actions";
import {
  getEnabledColorLayers,
  getResolutionInfo,
  getTransformsForLayer,
} from "../accessors/dataset_accessor";
import Dimensions from "../dimensions";
import { getActiveMagIndexForLayer } from "../accessors/flycam_accessor";
import { InferenceSession } from "onnxruntime-web";

const EMBEDDING_SIZE = [1024, 1024, 0] as Vector3;
type CacheEntry = { embedding: Float32Array; bbox: BoundingBox; mag: Vector3 };
const MAXIMUM_CACHE_SIZE = 5;
// Sorted from most recently to least recently used.
let embeddingCache: Array<CacheEntry> = [];

async function getEmbedding(
  dataset: APIDataset,
  boundingBox: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
): Promise<CacheEntry> {
  const matchingCacheEntry = embeddingCache.find(
    (entry) => entry.bbox.containsBoundingBox(boundingBox) && V3.equals(entry.mag, mag),
  );
  if (matchingCacheEntry) {
    // Move entry to the front.
    embeddingCache = [
      matchingCacheEntry,
      ...embeddingCache.filter((el) => el != matchingCacheEntry).slice(0, MAXIMUM_CACHE_SIZE - 1),
    ];
    console.log("Use", matchingCacheEntry, "from cache.");
    return matchingCacheEntry;
  } else {
    try {
      const embeddingCenter = V3.round(boundingBox.getCenter());
      const sizeInMag1 = V3.scale3(EMBEDDING_SIZE, mag);
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

      const embedding = new Float32Array(
        (await fetch(
          `/api/datasets/${dataset.owningOrganization}/${dataset.name}/layers/color/segmentAnythingEmbedding`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              mag,
              boundingBox: embeddingBoxMag1.asServerBoundingBox(),
            }),
          },
        ).then((res) => res.arrayBuffer())) as ArrayBuffer,
      );

      const newEntry = { embedding, bbox: embeddingBoxMag1, mag };
      embeddingCache.unshift(newEntry);
      return newEntry;
    } catch (exception) {
      console.error(exception);
      throw new Error("Could not load embedding. See console for details.");
    }
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

async function inferFromEmbedding(
  embedding: Float32Array,
  embeddingBoxInTargetMag: BoundingBox,
  userBoxInTargetMag: BoundingBox,
) {
  const topLeft = V3.sub(userBoxInTargetMag.min, embeddingBoxInTargetMag.min);
  const bottomRight = V3.sub(userBoxInTargetMag.max, embeddingBoxInTargetMag.min);

  const ort_session = await getSession();
  const onnx_coord = new Float32Array([topLeft[0], topLeft[1], bottomRight[0], bottomRight[1]]);
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
  const thresholdFieldData = new Uint8Array(thresholded_mask);

  const size = embeddingBoxInTargetMag.getSize();
  const stride = [1, size[0], size[0] * size[1]];
  console.log("stride", stride);
  let thresholdField = ndarray(thresholdFieldData, size, stride);

  thresholdField = thresholdField
    // a.lo(x,y) => a[x:, y:]
    .lo(topLeft[0], topLeft[1], 0)
    // a.hi(x,y) => a[:x, :y]
    .hi(userBoxInTargetMag.getSize()[0], userBoxInTargetMag.getSize()[1], 1);
  return thresholdField;
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    "COMPUTE_QUICK_SELECT_FOR_RECT",
    function* guard(action: ComputeQuickSelectForRectAction) {
      try {
        yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));
        yield* put(setIsQuickSelectActiveAction(true));
        yield* call(performQuickSelect, action);
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
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

  const { startPosition, endPosition } = action;
  const userBoxMag1 = new BoundingBox({
    min: V3.floor(V3.min(startPosition, endPosition)),
    max: V3.floor(
      V3.add(V3.max(startPosition, endPosition), Dimensions.transDim([0, 0, 1], activeViewport)),
    ),
  }); //.intersectedWith(layerBBox);

  // const layerBBox = yield* select((state) => getLayerBoundingBox(state.dataset, colorLayer.name));
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

  console.time("getEmbedding");
  const { embedding, bbox: embeddingBoxMag1 } = yield* call(
    getEmbedding,
    dataset,
    userBoxMag1,
    labeledResolution,
    activeViewport,
  );
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

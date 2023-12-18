import _ from "lodash";
import { OrthoView, Vector2, Vector3 } from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V3 } from "libs/mjs";
import {
  ComputeQuickSelectForAreaAction,
  ComputeQuickSelectForRectAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import ndarray, { NdArray } from "ndarray";
import Toast from "libs/toast";
import { OxalisState } from "oxalis/store";
import { map3 } from "libs/utils";
import { AdditionalCoordinate, APIDataset } from "types/api_flow_types";
import { getSamEmbedding, sendAnalyticsEvent } from "admin/admin_rest_api";
import Dimensions, { DimensionIndices } from "../dimensions";
import type { InferenceSession } from "onnxruntime-web";
import { finalizeQuickSelect, prepareQuickSelect } from "./quick_select_heuristic_saga";
import { VoxelBuffer2D } from "../volumetracing/volumelayer";
import { signedDist } from "./volume/volume_interpolation_saga";
import { Store } from "oxalis/singletons";
import {
  createNodeAction,
  createTreeAction,
  setTreeNameAction,
} from "../actions/skeletontracing_actions";
import { OrthoViewToNumber } from "oxalis/controller/combinations/skeleton_handlers";

const EMBEDDING_SIZE = [1024, 1024, 0] as Vector3;
type CacheEntry = {
  embeddingPromise: Promise<Float32Array>;
  embeddingBoxMag1: BoundingBox;
  mag: Vector3;
  layerName: string;
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
    session = ort.InferenceSession.create("/assets/models/vit_l_0b3195_decoder_quantized.onnx");
  }
  return session;
}

async function inferFromEmbedding(
  embedding: Float32Array,
  embeddingBoxInTargetMag: BoundingBox,
  userBoxInTargetMag: BoundingBox,
  activeViewport: OrthoView,
  voxelMap: VoxelBuffer2D | null,
  labeledZoomStep: number,
) {
  const [firstDim, secondDim, thirdDim] = Dimensions.getIndices(activeViewport);
  const topLeft = V3.sub(userBoxInTargetMag.min, embeddingBoxInTargetMag.min);
  const bottomRight = V3.sub(userBoxInTargetMag.max, embeddingBoxInTargetMag.min);
  const ort = await import("onnxruntime-web");

  let ortSession;
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
  let onnxCoord = new Float32Array([
    topLeft[maybeAdjustedFirstDim],
    topLeft[maybeAdjustedSecondDim],
    bottomRight[maybeAdjustedFirstDim],
    bottomRight[maybeAdjustedSecondDim],
  ]);

  // Fill input mask according to the voxel map.
  const onnxMaskInput = new Float32Array(256 * 256);
  let minDist = Number.MAX_VALUE;
  // The input mask is within the embedding box, so we need to calculate
  // which part of it is covered by the voxel map and fill the input mask
  // with 1s where the voxel map is to 1.
  const sampledPointsWithin: Array<[number, number]> = [];
  const sampledPointsOutside: Array<[number, number]> = [];
  const sampleAmount = 10;
  let minCoords = [0, 0];
  const mode = window?.squigglyMode || "distanceTransform";
  const getIndicesSample = (sampleAmount: number, indexLimit: number) => {
    const indices = [];
    while (indices.length < sampleAmount && indices.length < indexLimit) {
      const randomIndex = Math.floor(Math.random() * indexLimit);
      if (indices.indexOf(randomIndex) === -1) {
        indices.push(randomIndex);
      }
    }
    return indices;
  };
  if (voxelMap) {
    const samplingMode = window?.samplingMode || "index";
    const samplingPercentage = window?.samplingPercentage || 0.05;
    let firstDimOffset = topLeft[maybeAdjustedFirstDim];
    let secondDimOffset = topLeft[maybeAdjustedSecondDim];
    function visualizeSampledPoints(sampledPoints: Array<[number, number]>, treeName: string) {
      if (!window?.visualizeSampledPoints) {
        return;
      }

      Store.dispatch(createTreeAction());
      Store.dispatch(setTreeNameAction(treeName));
      sampledPoints.forEach(([x, y]) => {
        const coordsInViewport: Vector3 = [
          x + embeddingBoxInTargetMag.min[maybeAdjustedFirstDim],
          y + embeddingBoxInTargetMag.min[maybeAdjustedSecondDim],
          embeddingBoxInTargetMag.min[thirdDim],
        ];
        const globalCoords = Dimensions.transDim(coordsInViewport, activeViewport);
        Store.dispatch(
          createNodeAction(
            globalCoords,
            null,
            [0, 0, 0],
            OrthoViewToNumber[activeViewport],
            labeledZoomStep,
          ),
        );
      });
    }
    function pushCoords(array: Array<[number, number]>, x: number, y: number) {
      if (activeViewport === "PLANE_YZ") {
        array.push([y, x]);
      } else {
        array.push([x, y]);
      }
    }
    if (mode === "random") {
      let pointsInMaskCount = 0;
      let outsidePointsInMaskCount = 0;
      for (let i = 0; i < voxelMap.size; i++) {
        if (voxelMap.map[i] === 1) {
          pointsInMaskCount++;
        } else {
          outsidePointsInMaskCount++;
        }
      }

      const sampledInsidePointsIndices =
        samplingMode === "index" ? getIndicesSample(sampleAmount, pointsInMaskCount) : [];
      const sampledOutsidePointsIndices =
        samplingMode === "index" ? getIndicesSample(sampleAmount, outsidePointsInMaskCount) : [];

      pointsInMaskCount = 0;
      outsidePointsInMaskCount = 0;
      for (
        let i = 0;
        i < voxelMap.size;
        //&& (sampledPointsWithin.length < sampleAmount || sampledPointsOutside.length < sampleAmount);
        i++
      ) {
        if (voxelMap.map[i] === 1) {
          pointsInMaskCount++;
          const usePoint =
            samplingMode === "index"
              ? sampledInsidePointsIndices.indexOf(pointsInMaskCount) !== -1
              : Math.random() < samplingPercentage;
          if (usePoint) {
            const [x, y] = voxelMap.decomposeIndex(i);
            pushCoords(sampledPointsWithin, x + firstDimOffset, y + secondDimOffset);
          }
        } else {
          outsidePointsInMaskCount++;
          const usePoint =
            samplingMode === "index"
              ? sampledOutsidePointsIndices.indexOf(outsidePointsInMaskCount) !== -1
              : Math.random() < samplingPercentage;
          if (usePoint) {
            const [x, y] = voxelMap.decomposeIndex(i);
            pushCoords(sampledPointsOutside, x + firstDimOffset, y + secondDimOffset);
          }
        }
      }
      onnxCoord = new Float32Array([
        ..._.flattenDeep(sampledPointsWithin),
        ..._.flattenDeep(sampledPointsOutside),
        0,
        0,
      ]);
      visualizeSampledPoints(sampledPointsWithin, "sampledPointsWithin_random");
      visualizeSampledPoints(sampledPointsOutside, "sampledPointsOutside_random");
      console.log(
        "sampledPointsWithin",
        sampledPointsWithin.map(([x, y]) => [
          embeddingBoxInTargetMag.min[maybeAdjustedFirstDim] + x,
          embeddingBoxInTargetMag.min[maybeAdjustedSecondDim] + y,
        ]),
      );
      console.log(
        "sampledPointsOutside",
        sampledPointsOutside.map(([x, y]) => [
          embeddingBoxInTargetMag.min[maybeAdjustedFirstDim] + x,
          embeddingBoxInTargetMag.min[maybeAdjustedSecondDim] + y,
        ]),
      );
    } else if (mode === "mask") {
      // The voxel map is in the same resolution as the embedding box.
      // As the input mask is downsampled by a factor of 4 (256 in relation to 1024), we can only consider each fourth coordinate.
      firstDimOffset = Math.ceil(topLeft[maybeAdjustedFirstDim] / 4);
      secondDimOffset = Math.ceil(topLeft[maybeAdjustedSecondDim] / 4);
      for (let i = 0; i < voxelMap.width; i += 4) {
        for (let j = 0; j < voxelMap.height; j += 4) {
          const value = voxelMap.map[voxelMap.linearizeIndex(i, j)] === 1 ? 7 : -20;
          const iInMask = Math.floor(i / 4);
          const jInMask = Math.floor(j / 4);
          onnxMaskInput[(firstDimOffset + iInMask) * 256 + (secondDimOffset + jInMask)] = value;
          if (value === 7) {
            const dist =
              i * i +
              j * j +
              (voxelMap.width - i) * (voxelMap.width - i) +
              (voxelMap.height - j) * (voxelMap.height - j);
            if (dist < minDist) {
              minDist = dist;
              minCoords = [i, j];
            }
          }
        }
      }
      onnxCoord = new Float32Array([
        ...onnxCoord,
        topLeft[maybeAdjustedFirstDim] + minCoords[0],
        topLeft[maybeAdjustedSecondDim] + minCoords[1],
        0,
        0,
      ]);
    } else if (mode === "distanceTransform") {
      const twoDimVoxelMap = ndarray(
        voxelMap.map,
        [voxelMap.height, voxelMap.width],
        [1, voxelMap.height],
      );
      const distanceTransformed: NdArray<Uint8Array> = signedDist(twoDimVoxelMap) as any;
      const min = _.min(distanceTransformed.data) || -1;
      const max = _.max(distanceTransformed.data) || 1;
      const maxLowerLimit = Math.max(max * 0.1, 3);
      const maxUpperLimit = Math.min(Math.max(max * 0.4, 4), 7);
      const minLimit = Math.min(min * 0.3, -1);
      let pointsInMaskCount = 0;
      let outsidePointsInMaskCount = 0;
      const pointsCountAboveLimit =
        samplingMode === "index"
          ? distanceTransformed.data.reduce(
              (acc, cur) => (cur >= maxLowerLimit && cur <= maxUpperLimit ? acc + 1 : acc),
              0,
            )
          : 10;
      const pointsCountBelowLimit =
        samplingMode === "index"
          ? distanceTransformed.data.reduce((acc, cur) => (cur <= minLimit ? acc + 1 : acc), 0)
          : 10;
      const sampledInsidePointsIndices =
        samplingMode === "index" ? getIndicesSample(sampleAmount, pointsCountBelowLimit) : [];
      const sampledOutsidePointsIndices =
        samplingMode === "index" ? getIndicesSample(sampleAmount, pointsCountAboveLimit) : [];
      for (
        let i = 0;
        i < distanceTransformed.data.length;
        // && (sampledPointsWithin.length < sampleAmount || sampledPointsOutside.length < sampleAmount);
        i++
      ) {
        const distanceValue = distanceTransformed.data[i];
        if (distanceValue <= minLimit) {
          pointsInMaskCount++;
          const usePoint =
            samplingMode === "index"
              ? sampledInsidePointsIndices.indexOf(pointsInMaskCount) !== -1
              : Math.random() < samplingPercentage;
          if (usePoint) {
            const [x, y] = voxelMap.decomposeIndex(i);
            pushCoords(sampledPointsWithin, x + firstDimOffset, y + secondDimOffset);
          }
        } else if (distanceValue >= maxLowerLimit && distanceValue <= maxUpperLimit) {
          outsidePointsInMaskCount++;
          const usePoint =
            samplingMode === "index"
              ? sampledOutsidePointsIndices.indexOf(outsidePointsInMaskCount) !== -1
              : Math.random() < samplingPercentage;
          if (usePoint) {
            const [x, y] = voxelMap.decomposeIndex(i);
            pushCoords(sampledPointsOutside, x + firstDimOffset, y + secondDimOffset);
          }
        }
      }
      onnxCoord = new Float32Array([
        ..._.flattenDeep(sampledPointsWithin),
        ..._.flattenDeep(sampledPointsOutside),
        0,
        0,
      ]);
      // Location: 3187, 3938, 833
      visualizeSampledPoints(sampledPointsWithin, "sampledPointsWithin_distanceTransform");
      visualizeSampledPoints(sampledPointsOutside, "sampledPointsOutside_distanceTransform");
      console.log(
        "sampledPointsWithin",
        sampledPointsWithin.map(([x, y]) => [
          embeddingBoxInTargetMag.min[maybeAdjustedFirstDim] + x,
          embeddingBoxInTargetMag.min[maybeAdjustedSecondDim] + y,
        ]),
      );
      console.log(
        "sampledPointsOutside",
        sampledPointsOutside.map(([x, y]) => [
          embeddingBoxInTargetMag.min[maybeAdjustedFirstDim] + x,
          embeddingBoxInTargetMag.min[maybeAdjustedSecondDim] + y,
        ]),
      );
      console.log("width", voxelMap.width, "height", voxelMap.height);
      // TODO: Visualize transformed distance map
      let cvs = (document.getElementById("mask-123") ||
        document.createElement("canvas")) as any as HTMLCanvasElement;
      let ctx = cvs.getContext("2d");
      if (ctx) {
        let imgData = ctx.createImageData(voxelMap.width, voxelMap.height);
        // width first
        for (let i = 0; i < voxelMap.height; i++) {
          for (let j = 0; j < voxelMap.width; j++) {
            const idx = i * voxelMap.width + j;
            const value = distanceTransformed.get(i, j);
            imgData.data[idx * 4 + 0] = value < 0 ? (value / min) * 255 : 0;
            //imgData.data[idx * 4 + 0] = 0;
            imgData.data[idx * 4 + 1] = value > 0 ? (value / max) * 255 : 0;
            //imgData.data[idx * 4 + 1] = 0;
            imgData.data[idx * 4 + 2] = 0;
            imgData.data[idx * 4 + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      }
      cvs.id = "mask-123";
      document.body.appendChild(cvs);
    } else {
      throw new Error("Unknown squiggly mode");
    }
  }
  // Inspired by https://github.com/facebookresearch/segment-anything/blob/main/notebooks/onnx_model_example.ipynb
  // TODO: Get mask into correct value range.
  // TODO: Check whether using two fixed points from distance transform might be better than the bounding box as input points
  let onnxLabel = new Float32Array([2, 3]);
  if (voxelMap && (mode === "random" || mode === "distanceTransform")) {
    onnxLabel = new Float32Array([
      ...Array(sampledPointsWithin.length).fill(1),
      ...Array(sampledPointsOutside.length).fill(-1),
      -1,
    ]);
  } else if (voxelMap && mode === "mask") {
    onnxLabel = new Float32Array([...onnxLabel, 1, -1]);
  }

  const onnxHasMaskInput =
    voxelMap != null && mode === "mask" ? new Float32Array([1]) : new Float32Array([0]);
  const origImSize = new Float32Array([1024, 1024]);
  console.log("onnxCoord", onnxCoord);
  console.log("onnxLabel", onnxLabel);
  const ortInputs = {
    image_embeddings: new ort.Tensor("float32", embedding, [1, 256, 64, 64]),
    point_coords: new ort.Tensor("float32", onnxCoord, [1, onnxCoord.length / 2, 2]),
    point_labels: new ort.Tensor("float32", onnxLabel, [1, onnxLabel.length]),
    mask_input: new ort.Tensor("float32", onnxMaskInput, [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", onnxHasMaskInput, [1]),
    orig_im_size: new ort.Tensor("float32", origImSize, [2]),
  };

  // Use intersection-over-union estimates to pick the best mask.
  const { masks, iou_predictions: iouPredictions } = await ortSession.run(ortInputs);
  // @ts-ignore
  const bestMaskIndex = iouPredictions.data.indexOf(Math.max(...iouPredictions.data));
  const maskData = new Uint8Array(EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]);
  const maskAreaData = [];
  // Fill the mask data with a for loop (slicing/mapping would incur additional
  // data copies).
  const startOffset = bestMaskIndex * EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1];
  for (let idx = 0; idx < EMBEDDING_SIZE[0] * EMBEDDING_SIZE[1]; idx++) {
    const x = idx % EMBEDDING_SIZE[0];
    const y = Math.floor(idx / EMBEDDING_SIZE[0]);
    if (x >= onnxCoord[0] && x < onnxCoord[2] && y >= onnxCoord[1] && y < onnxCoord[3]) {
      maskAreaData.push(masks.data[idx + startOffset]);
      /*const xInArea = x - onnxCoord[0];
      const yInArea = y - onnxCoord[1];
      const idxInArea = xInArea + yInArea * (onnxCoord[2]- onnxCoord[0]);
      maskAreaData[idxInArea] = masks.data[idx + startOffset];*/
    }
    maskData[idx] = masks.data[idx + startOffset] > 0 ? 1 : 0;
  }

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

function getUserBoundingBoxesInMag1(
  action: ComputeQuickSelectForRectAction | ComputeQuickSelectForAreaAction,
  labeledResolution: Vector3,
  activeViewport: OrthoView,
  thirdDim: DimensionIndices,
) {
  if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
    const { startPosition, endPosition } = action;

    // Effectively, zero the first and second dimension in the mag.
    const depthSummand = V3.scale3(
      labeledResolution,
      Dimensions.transDim([0, 0, 1], activeViewport),
    );
    const unalignedUserBoxMag1 = new BoundingBox({
      min: V3.floor(V3.min(startPosition, endPosition)),
      max: V3.floor(V3.add(V3.max(startPosition, endPosition), depthSummand)),
    });
    const alignedUserBoundingBoxMag1 = unalignedUserBoxMag1.alignWithMag(
      labeledResolution,
      "floor",
    );
    return { alignedUserBoundingBoxMag1, unalignedUserBoxMag1 };
  } else {
    const { voxelMap } = action;
    const unalignedVoxelMapBoundingBoxMag1 = action.boundingBox;
    // Reducing the third dimension to a single voxel as the volume layer of the bounding box has additional padding in the third dimension.
    // This is necessary to be within the allowed volume size of the inferral.
    unalignedVoxelMapBoundingBoxMag1.min[thirdDim] = voxelMap.get3DCoordinate([0, 0])[thirdDim];
    unalignedVoxelMapBoundingBoxMag1.max[thirdDim] =
      unalignedVoxelMapBoundingBoxMag1.min[thirdDim] + 1;
    const alignedUserBoundingBoxMag1 = unalignedVoxelMapBoundingBoxMag1.alignWithMag(
      labeledResolution,
      "floor",
    );
    return { alignedUserBoundingBoxMag1, unalignedUserBoxMag1: unalignedVoxelMapBoundingBoxMag1 };
  }
}

export default function* performQuickSelect(
  action: ComputeQuickSelectForRectAction | ComputeQuickSelectForAreaAction,
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
  const quickSelectGeometry =
    action.type === "COMPUTE_QUICK_SELECT_FOR_RECT" ? action.quickSelectGeometry : null;
  const voxelMap: VoxelBuffer2D | null =
    action.type === "COMPUTE_QUICK_SELECT_FOR_AREA" ? action.voxelMap : null;
  const { alignedUserBoundingBoxMag1, unalignedUserBoxMag1 } = getUserBoundingBoxesInMag1(
    action,
    labeledResolution,
    activeViewport,
    thirdDim,
  );
  if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
    // Ensure that the third dimension is inclusive (otherwise, the center of the passed
    // coordinates wouldn't be exactly on the W plane on which the user started this action).
    const inclusiveMaxW = map3(
      (el, idx) => (idx === thirdDim ? el - 1 : el),
      unalignedUserBoxMag1.max,
    );
    action.quickSelectGeometry.setCoordinates(unalignedUserBoxMag1.min, inclusiveMaxW);
  }
  const dataset = yield* select((state: OxalisState) => state.dataset);
  const layerConfiguration = yield* select(
    (state) => state.datasetConfiguration.layers[colorLayer.name],
  );
  const { intensityRange } = layerConfiguration;

  const { embeddingPromise, embeddingBoxMag1 } = yield* call(
    getEmbedding,
    dataset,
    colorLayer.name,
    alignedUserBoundingBoxMag1,
    labeledResolution,
    activeViewport,
    additionalCoordinates || [],
    colorLayer.elementClass === "uint8" ? null : intensityRange,
  );
  let embedding;
  try {
    embedding = yield embeddingPromise;
  } catch (exception) {
    console.error(exception);
    removeEmbeddingPromiseFromCache(embeddingPromise);
    throw new Error("Could not load embedding. See console for details.");
  }

  const embeddingBoxInTargetMag = embeddingBoxMag1.fromMag1ToMag(labeledResolution);
  const alignedUserBoundingBox = alignedUserBoundingBoxMag1.fromMag1ToMag(labeledResolution);

  if (embeddingBoxInTargetMag.getVolume() === 0) {
    Toast.warning("The drawn rectangular had a width or height of zero.");
    return;
  }

  let mask = yield* call(
    inferFromEmbedding,
    embedding,
    embeddingBoxInTargetMag,
    alignedUserBoundingBox,
    activeViewport,
    voxelMap,
    labeledZoomStep,
  );
  if (!mask) {
    Toast.error("Could not infer mask. See console for details.");
    return;
  }

  const overwriteMode = yield* select(
    (state: OxalisState) => state.userConfiguration.overwriteMode,
  );

  sendAnalyticsEvent("used_quick_select_with_ai");
  yield* finalizeQuickSelect(
    quickSelectGeometry,
    volumeTracing,
    activeViewport,
    labeledResolution,
    alignedUserBoundingBoxMag1,
    thirdDim,
    alignedUserBoundingBox.getSize(),
    firstDim,
    secondDim,
    mask,
    overwriteMode,
    labeledZoomStep,
  );
}

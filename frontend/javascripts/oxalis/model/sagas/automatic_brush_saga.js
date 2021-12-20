// @flow
import * as tf from "@tensorflow/tfjs";
import memoizeOne from "memoize-one";
import React from "react";
import { type Saga, call, fork, select, take, _cancel } from "oxalis/model/sagas/effect-generators";
import floodfill from "libs/floodfill";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import { type InferSegmentationInViewportAction } from "oxalis/model/actions/volumetracing_actions";
import { sleep } from "libs/utils";
import { type Vector2, type Vector3, type OrthoView, OrthoViews } from "oxalis/constants";
import { getMeanAndStdDevFromDataset } from "admin/admin_rest_api";
import type { APIDataset } from "types/api_flow_types";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import TensorFlowWorker from "oxalis/workers/tensorflow.worker";
import mainThreadPredict from "oxalis/workers/tensorflow.impl";
import ThreeDMap from "libs/ThreeDMap";
import Model from "oxalis/model";
import Toast from "libs/toast";
import Dimensions from "oxalis/model/dimensions";
import Shortcut from "libs/shortcut_component";
import api from "oxalis/api/internal_api";
import {
  getPosition,
  getPlaneExtentInVoxelFromStore,
} from "oxalis/model/accessors/flycam_accessor";
import { V2 } from "libs/mjs";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import window from "libs/window";

const outputExtent = 100;
const inputContextExtent = 20;
const inputExtent = outputExtent + 2 * inputContextExtent;
const NUM_PREDICT_SLICES = 3;

// Will remove model validation, NaN checks, and other correctness checks in favor of performance
if (process.env.NODE_ENV === "production") tf.enableProdMode();

const workerPredict = createWorker(TensorFlowWorker);

const configureTensorFlow = (useWebworker, useGPU) => {
  window.useWebworker = useWebworker;
  window.useGPU = useGPU;
  if (process.env.BABEL_ENV !== "test") {
    console.log("useWebworker set to", useWebworker, "and useGPU set to", useGPU);
  }
};

// $FlowIssue[cannot-resolve-name]
const isOffscreenCanvasSupported = typeof OffscreenCanvas !== "undefined";
configureTensorFlow(isOffscreenCanvasSupported, true);
window.configureTensorFlow = configureTensorFlow;

const meanAndStdDevFromDataset = memoizeOne(
  (dataset: APIDataset, layerName: string): Promise<{ mean: number, stdDev: number }> =>
    getMeanAndStdDevFromDataset(dataset.dataStore.url, dataset, layerName),
);

const getUseWebworkerAndGPU = () => {
  const useWebworker = window.useWebworker != null ? window.useWebworker : false;
  const useGPU = window.useGPU != null ? window.useGPU : false;
  return { useWebworker, useGPU };
};

const getPredictionForTile = async (
  tileX,
  tileY,
  tileZ,
  activeViewport,
  dataset,
  colorLayerName,
) => {
  const x = tileX * outputExtent;
  const y = tileY * outputExtent;
  const z = tileZ;
  const min = Dimensions.transDim(
    [x - inputContextExtent, y - inputContextExtent, z],
    activeViewport,
  );
  const max = Dimensions.transDim(
    [x - inputContextExtent + inputExtent, y - inputContextExtent + inputExtent, z + 1],
    activeViewport,
  );

  const cuboidData = await api.data.getDataFor2DBoundingBox(colorLayerName, {
    min,
    max,
  });

  const { mean, stdDev } = await meanAndStdDevFromDataset(dataset, colorLayerName);
  const tensorArray = new Float32Array(new Uint8Array(cuboidData)).map(
    // This is how the model was trained
    el => ((el - mean) / stdDev) * (1 / 3) ** 0.5,
  );
  // When interpreting the 3d data slice as a 2d slice, the x and y axis are flipped only on the YZ plane
  const isXYflipped = activeViewport === OrthoViews.PLANE_YZ;
  const { useWebworker, useGPU } = getUseWebworkerAndGPU();

  return useWebworker
    ? workerPredict(useGPU, tensorArray.buffer, inputExtent, isXYflipped)
    : mainThreadPredict(useGPU, tf, tensorArray.buffer, inputExtent, isXYflipped);
};

const labelFloodedVoxels = async (
  predictions: ThreeDMap<Uint8Array>,
  activeViewport: OrthoView,
  activeCellId: number,
  floodedVoxels: Array<Vector3>,
) => {
  console.time("label");
  if (floodedVoxels.length > 0) {
    // Clean up - If the whole z slice has been flooded, the prediction is no longer needed
    const [, , tileZ] = floodedVoxels[0];
    predictions.delete(tileZ);
  }
  const voxelAddresses = floodedVoxels.map(addressUVW =>
    Dimensions.transDim(addressUVW, activeViewport),
  );
  api.data.labelVoxels(voxelAddresses, activeCellId);
  console.timeEnd("label");
  // Do not block the main thread and allow for some interactivity after labeling a slice
  await sleep(500);
};

export default function* inferSegmentInViewport(
  action: InferSegmentationInViewportAction,
): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") return;

  const FLOODFILL_THRESHOLD = window.floodfillThreshold || 0.6;

  let aborted = false;
  const toastConfig = {
    onClose: () => {
      aborted = true;
    },
    sticky: true,
    key: "automatic-brush",
  };
  const getEscapableToast = text => (
    <div>
      {text}
      <Shortcut
        keys="esc"
        onTrigger={() => {
          aborted = true;
          Toast.close(toastConfig.key);
        }}
      />
    </div>
  );

  const brushIsActiveText = "Automatic brush is active. Close the toast to stop using it.";
  Toast.info(getEscapableToast(brushIsActiveText), toastConfig);

  const colorLayers = yield* call([Model, Model.getColorLayers]);
  const colorLayerName = colorLayers[0].name;
  if (colorLayers.length > 1) {
    Toast.warning(
      `There are multiple color layers. Using ${colorLayerName} for automatic segmentation.`,
    );
  }
  let [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );
  const dataset = yield* select(state => state.dataset);
  const activeCellId = yield* select(state => {
    if (state.tracing.volumes.length === 0) {
      throw new Error("No volume tracing available.");
    }
    return state.tracing.volumes[0].activeCellId;
  });

  let [curX, curY, curZ] = Dimensions.transDim(
    Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam))),
    activeViewport,
  );
  const clickPosition = Dimensions.transDim(
    Dimensions.roundCoordinate(action.position),
    activeViewport,
  );

  const predictions: ThreeDMap<Uint8Array> = new ThreeDMap();
  const { useWebworker, useGPU } = getUseWebworkerAndGPU();
  console.log("useWebworker", useWebworker);
  console.log("useGPU", useGPU);

  function* currentPositionAndViewportUpdater(): Saga<void> {
    while (true) {
      yield* take(FlycamActions);
      [curX, curY, curZ] = Dimensions.transDim(
        Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam))),
        activeViewport,
      );
      [halfViewportExtentX, halfViewportExtentY] = yield* call(
        getHalfViewportExtents,
        activeViewport,
      );
    }
  }

  const getter = async (x, y, z): Promise<boolean> => {
    if (
      x < curX - halfViewportExtentX ||
      y < curY - halfViewportExtentY ||
      z < curZ ||
      x >= curX + halfViewportExtentX ||
      y >= curY + halfViewportExtentY
    ) {
      return false;
    }

    // If the current z-slice is too far ahead, wait
    // eslint-disable-next-line no-await-in-loop
    while (z >= curZ + NUM_PREDICT_SLICES && !aborted) await sleep(500);

    const tileX = Math.floor(x / outputExtent);
    const tileY = Math.floor(y / outputExtent);
    const tileZ = z;

    if (predictions.get([tileZ, tileY, tileX]) == null) {
      // Do not make new predictions if the automatic brush has been aborted
      if (aborted) return false;
      console.time("predict");
      const thirdDimension = Dimensions.thirdDimensionForPlane(activeViewport);
      Toast.info(
        getEscapableToast(
          `${brushIsActiveText}\nLabeling ${["x", "y", "z"][thirdDimension]}=${z}.`,
        ),
        toastConfig,
      );
      predictions.set(
        [tileZ, tileY, tileX],
        await getPredictionForTile(tileX, tileY, tileZ, activeViewport, dataset, colorLayerName),
      );
      console.timeEnd("predict");
    }

    const relX = x % outputExtent;
    const relY = y % outputExtent;
    const prediction = predictions.get([tileZ, tileY, tileX]);
    if (prediction != null) return prediction[relX * outputExtent + relY] > FLOODFILL_THRESHOLD;
    throw new Error("This should never happen, prediction was set, but geting it failed.");
  };

  const seed = clickPosition;
  const seedPrediction = yield* call(getter, ...seed);
  if (seedPrediction) {
    // Keep updating the current position
    const updaterTask = yield* fork(currentPositionAndViewportUpdater);

    // Do not use _.partial in order to keep type information
    const onFlood = voxels => labelFloodedVoxels(predictions, activeViewport, activeCellId, voxels);
    // This call will block until the automatic brush is aborted or the floodfill is exhausted
    yield* call(floodfill, { getter, seed, onFlood });

    yield _cancel(updaterTask);
  } else {
    Toast.warning("Click position is classified as border, please click inside a segment instead.");
  }

  Toast.close(toastConfig.key);
}

export function* getHalfViewportExtents(activeViewport: OrthoView): Saga<Vector2> {
  const zoom = yield* select(state => state.flycam.zoomStep);
  const baseVoxelFactors = yield* select(state =>
    Dimensions.transDim(getBaseVoxelFactors(state.dataset.dataSource.scale), activeViewport),
  );
  const viewportExtents = yield* select(state =>
    getPlaneExtentInVoxelFromStore(state, zoom, activeViewport),
  );
  const scaledViewportExtents = V2.scale2(viewportExtents, baseVoxelFactors);

  const halfViewportExtents = scaledViewportExtents.map(extent => Math.round(extent / 2));
  return halfViewportExtents;
}

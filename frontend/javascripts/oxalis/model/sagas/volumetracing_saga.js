/**
 * volumetracing_saga.js
 * @flow
 */
import _ from "lodash";
import * as tf from "@tensorflow/tfjs";
import memoizeOne from "memoize-one";

import floodfill from "libs/floodfill";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  type CopySegmentationLayerAction,
  resetContourAction,
  updateDirectionAction,
  type InferSegmentationInViewportAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  type Saga,
  _take,
  _takeEvery,
  call,
  fork,
  put,
  race,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { type UpdateAction, updateVolumeTracing } from "oxalis/model/sagas/update_actions";
import { V2, V3 } from "libs/mjs";
import type { VolumeTracing, Flycam } from "oxalis/store";
import {
  enforceVolumeTracing,
  isVolumeTracingDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import {
  getPosition,
  getRotation,
  getPlaneExtentInVoxelFromStore,
} from "oxalis/model/accessors/flycam_accessor";
import { sleep } from "libs/utils";
import {
  type BoundingBoxType,
  type Vector2,
  type Vector3,
  type ContourMode,
  ContourModeEnum,
  type OrthoView,
  type VolumeTool,
  VolumeToolEnum,
} from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import api from "oxalis/api/internal_api";
import { getMeanAndStdDevFromDataset } from "admin/admin_rest_api";
import type { APIDataset } from "admin/api_flow_types";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import TensorFlowWorker from "oxalis/workers/tensorflow.worker";
import mainThreadPredict from "oxalis/workers/tensorflow.impl";
import ThreeDMap from "libs/ThreeDMap";

// Will remove model validation, NaN checks, and other correctness checks in favor of performance
if (process.env.NODE_ENV === "production") tf.enableProdMode();

const workerPredict = createWorker(TensorFlowWorker);

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
  yield _takeEvery("INFER_SEGMENT_IN_VIEWPORT", inferSegmentInViewport);
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  if (yield* select(state => state.tracing.volume == null)) {
    return;
  }

  const isOpacityTooLow = yield* select(
    state => state.datasetConfiguration.segmentationOpacity < 10,
  );
  if (isOpacityTooLow) {
    Toast.warning(
      'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
    );
  }
}

function* getHalfViewportExtents(activeViewport): Saga<Vector2> {
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

export function* editVolumeLayerAsync(): Generator<any, any, any> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield* take("START_EDITING");
    if (startEditingAction.type !== "START_EDITING") {
      throw new Error("Unexpected action. Satisfy flow.");
    }
    const contourTracingMode = yield* select(
      state => enforceVolumeTracing(state.tracing).contourTracingMode,
    );

    // Volume tracing for higher zoomsteps is currently not allowed
    if (yield* select(state => isVolumeTracingDisallowed(state))) {
      continue;
    }
    const currentLayer = yield* call(createVolumeLayer, startEditingAction.planeId);
    const activeTool = yield* select(state => enforceVolumeTracing(state.tracing).activeTool);

    const initialViewport = yield* select(state => state.viewModeData.plane.activeViewport);
    const activeViewportBounding = yield* call(getBoundingsFromPosition, initialViewport);
    if (activeTool === VolumeToolEnum.BRUSH) {
      yield* call(
        labelWithIterator,
        currentLayer.getCircleVoxelIterator(startEditingAction.position, activeViewportBounding),
        contourTracingMode,
      );
    }

    while (true) {
      const { addToLayerAction, finishEditingAction } = yield* race({
        addToLayerAction: _take("ADD_TO_LAYER"),
        finishEditingAction: _take("FINISH_EDITING"),
      });

      if (finishEditingAction) break;
      if (!addToLayerAction || addToLayerAction.type !== "ADD_TO_LAYER") {
        throw new Error("Unexpected action. Satisfy flow.");
      }
      const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
      if (initialViewport !== activeViewport) {
        // if the current viewport does not match the initial viewport -> dont draw
        continue;
      }
      if (activeTool === VolumeToolEnum.TRACE || activeTool === VolumeToolEnum.BRUSH) {
        currentLayer.addContour(addToLayerAction.position);
      }
      if (activeTool === VolumeToolEnum.BRUSH) {
        const currentViewportBounding = yield* call(getBoundingsFromPosition, activeViewport);
        yield* call(
          labelWithIterator,
          currentLayer.getCircleVoxelIterator(addToLayerAction.position, currentViewportBounding),
          contourTracingMode,
        );
      }
    }

    yield* call(finishLayer, currentLayer, activeTool, contourTracingMode);
  }
}

function* getBoundingsFromPosition(currentViewport: OrthoView): Saga<?BoundingBoxType> {
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const halfViewportExtents = yield* call(getHalfViewportExtents, currentViewport);
  const halfViewportExtentsUVW = Dimensions.transDim([...halfViewportExtents, 0], currentViewport);
  return {
    min: V3.sub(position, halfViewportExtentsUVW),
    max: V3.add(position, halfViewportExtentsUVW),
  };
}

function* createVolumeLayer(planeId: OrthoView): Saga<VolumeLayer> {
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}

function* labelWithIterator(iterator, contourTracingMode): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
  const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  switch (contourTracingMode) {
    case ContourModeEnum.DRAW_OVERWRITE:
      yield* call([cube, cube.labelVoxels], iterator, activeCellId);
      break;
    case ContourModeEnum.DRAW:
      yield* call([cube, cube.labelVoxels], iterator, activeCellId, 0);
      break;
    case ContourModeEnum.DELETE_FROM_ACTIVE_CELL:
      yield* call([cube, cube.labelVoxels], iterator, 0, activeCellId);
      break;
    case ContourModeEnum.DELETE_FROM_ANY_CELL:
      yield* call([cube, cube.labelVoxels], iterator, 0);
      break;
    default:
      throw new Error("Invalid volume tracing mode.");
  }
}

function* copySegmentationLayer(action: CopySegmentationLayerAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );

  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);

  function copyVoxelLabel(voxelTemplateAddress, voxelTargetAddress) {
    const templateLabelValue = segmentationLayer.cube.getDataValue(voxelTemplateAddress);

    // Only copy voxels from the previous layer which belong to the current cell
    if (templateLabelValue === activeCellId) {
      const currentLabelValue = segmentationLayer.cube.getDataValue(voxelTargetAddress);

      // Do not overwrite already labelled voxels
      if (currentLabelValue === 0) {
        api.data.labelVoxels([voxelTargetAddress], templateLabelValue);
      }
    }
  }

  const directionInverter = action.source === "nextLayer" ? 1 : -1;
  const spaceDirectionOrtho = yield* select(state => state.flycam.spaceDirectionOrtho);
  const dim = Dimensions.getIndices(activeViewport)[2];
  const direction = spaceDirectionOrtho[dim];

  const [tx, ty, tz] = Dimensions.transDim(position, activeViewport);
  const z = tz;
  for (let x = tx - halfViewportExtentX; x < tx + halfViewportExtentX; x++) {
    for (let y = ty - halfViewportExtentY; y < ty + halfViewportExtentY; y++) {
      copyVoxelLabel(
        Dimensions.transDim([x, y, tz + direction * directionInverter], activeViewport),
        Dimensions.transDim([x, y, z], activeViewport),
      );
    }
  }
}

const configureTensorFlow = (useWebworker, useGPU) => {
  window.useWebworker = useWebworker;
  window.useGPU = useGPU;
  console.log("useWebworker set to", useWebworker, "and useGPU set to", useGPU);
};

// $FlowIgnore
const isOffscreenCanvasSupported = typeof OffscreenCanvas !== "undefined";
configureTensorFlow(isOffscreenCanvasSupported, true);
window.configureTensorFlow = configureTensorFlow;

const meanAndStdDevFromDataset = memoizeOne(
  (dataset: APIDataset, layerName: string): Promise<{ mean: number, stdDev: number }> =>
    getMeanAndStdDevFromDataset(dataset.dataStore.url, dataset, layerName),
);

function* inferSegmentInViewport(action: InferSegmentationInViewportAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") return;

  const outputExtent = 100;
  const inputContextExtent = 20;
  const inputExtent = outputExtent + 2 * inputContextExtent;
  const NUM_PREDICT_SLICES = 3;
  const FLOODFILL_THRESHOLD = 0.7;

  let aborted = false;
  const toastConfig = {
    onClose: () => {
      aborted = true;
    },
    sticky: true,
    key: "magic-wand",
  };
  const toastDescription = "Magic Wand is active. Close the toast to stop using it.";

  Toast.info(toastDescription, toastConfig);

  const colorLayers = yield* call([Model, Model.getColorLayers]);
  const colorLayer = colorLayers[0];
  if (colorLayers.length > 1) {
    Toast.warning(
      `There are multiple color layers. Using ${colorLayer.name} for automatic segmentation.`,
    );
  }
  const [halfViewportExtentX, halfViewportExtentY] = yield* call(
    getHalfViewportExtents,
    activeViewport,
  );
  const dataset = yield* select(state => state.dataset);
  const { mean, stdDev } = yield* call(meanAndStdDevFromDataset, dataset, colorLayer.name);
  const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);

  let [curX, curY, curZ] = Dimensions.transDim(
    Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam))),
    activeViewport,
  );
  const clickPosition = Dimensions.transDim(
    Dimensions.roundCoordinate(action.position),
    activeViewport,
  );

  const predictions = new ThreeDMap();
  const useWebworker = window.useWebworker != null ? window.useWebworker : false;
  const useGPU = window.useGPU != null ? window.useGPU : false;
  console.log("useWebworker", useWebworker);
  console.log("useGPU", useGPU);

  const getPredictionForTile = async (tileX, tileY, tileZ) => {
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

    const cuboidData = await api.data.getDataFor2DBoundingBox(colorLayer.name, {
      min,
      max,
    });

    const tensorArray = new Float32Array(new Uint8Array(cuboidData)).map(
      el => (el - mean) / stdDev,
    );

    return useWebworker
      ? workerPredict(useGPU, tensorArray.buffer, inputExtent)
      : mainThreadPredict(useGPU, tf, tensorArray.buffer, inputExtent);
  };

  function* currentPositionUpdater(): Saga<void> {
    while (!aborted) {
      yield* take(FlycamActions);
      const curPosition = Dimensions.transDim(
        Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam))),
        activeViewport,
      );
      [curX, curY, curZ] = curPosition;
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

    if (predictions.get([tileX, tileY, tileZ]) == null) {
      // Do not make new predictions if the magic wand has been aborted
      if (aborted) return false;
      console.time("predict");
      Toast.info(`${toastDescription}\nLabeling slice ${z}.`, toastConfig);
      predictions.set([tileX, tileY, tileZ], await getPredictionForTile(tileX, tileY, tileZ));
      console.timeEnd("predict");
    }

    const relX = x % outputExtent;
    const relY = y % outputExtent;
    const prediction = predictions.get([tileX, tileY, tileZ]);
    if (prediction != null) return prediction[relX * outputExtent + relY] > FLOODFILL_THRESHOLD;
    throw new Error("This should never happen, prediction was set, but geting it failed.");
  };

  const onFlood = async (floodedVoxels: Array<Vector3>) => {
    console.time("label");
    const voxelAddresses = floodedVoxels.map(addressUVW =>
      Dimensions.transDim(addressUVW, activeViewport),
    );
    api.data.labelVoxels(voxelAddresses, activeCellId);
    console.timeEnd("label");
    // Do not block the main thread and allow for some interactivity after labeling a slice
    await sleep(500);
  };

  const seed = clickPosition;
  const seedPrediction = yield* call(getter, ...seed);
  if (seedPrediction) {
    // The floodfill will run until aborted
    floodfill({ getter, seed, onFlood });

    // Keep updating the current position
    yield* call(currentPositionUpdater);
  } else {
    Toast.warning("Click position is classified as border, please click inside a segment instead.");
  }

  Toast.close(toastConfig.key);
}

export function* finishLayer(
  layer: VolumeLayer,
  activeTool: VolumeTool,
  contourTracingMode: ContourMode,
): Saga<void> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (activeTool === VolumeToolEnum.TRACE || activeTool === VolumeToolEnum.BRUSH) {
    const start = Date.now();

    yield* call(labelWithIterator, layer.getVoxelIterator(activeTool), contourTracingMode);

    console.log("Labeling time:", Date.now() - start);
  }

  yield* put(updateDirectionAction(layer.getCentroid()));
  yield* put(resetContourAction());
}

export function* disallowVolumeTracingWarning(): Saga<*> {
  while (true) {
    yield* take(["SET_TOOL", "CYCLE_TOOL"]);
    if (yield* select(state => isVolumeTracingDisallowed(state))) {
      Toast.warning("Volume tracing is not possible at this zoom level. Please zoom in further.");
    }
  }
}

function updateTracingPredicate(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): boolean {
  return (
    !_.isEqual(prevVolumeTracing.userBoundingBox, volumeTracing.userBoundingBox) ||
    prevVolumeTracing.activeCellId !== volumeTracing.activeCellId ||
    prevVolumeTracing.maxCellId !== volumeTracing.maxCellId ||
    prevFlycam !== flycam
  );
}

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
): Generator<UpdateAction, void, void> {
  if (updateTracingPredicate(prevVolumeTracing, volumeTracing, prevFlycam, flycam)) {
    yield updateVolumeTracing(
      volumeTracing,
      V3.floor(getPosition(flycam)),
      getRotation(flycam),
      flycam.zoomStep,
    );
  }
}

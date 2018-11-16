/**
 * volumetracing_saga.js
 * @flow
 */
import _ from "lodash";
import * as tf from "@tensorflow/tfjs";

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
import { V3 } from "libs/mjs";
import type { VolumeTracing, Flycam } from "oxalis/store";
import {
  enforceVolumeTracing,
  isVolumeTracingDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import Constants, {
  type BoundingBoxType,
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
      if (activeTool === VolumeToolEnum.TRACE) {
        currentLayer.addContour(addToLayerAction.position);
      } else if (activeTool === VolumeToolEnum.BRUSH) {
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
  const zoom = yield* select(state => state.flycam.zoomStep);
  const baseVoxelFactors = yield* select(state =>
    getBaseVoxelFactors(state.dataset.dataSource.scale),
  );
  const halfViewportWidth = Math.round((Constants.PLANE_WIDTH / 2) * zoom);
  const relevantCoordinates = Dimensions.transDim([1, 1, 0], currentViewport);
  let halfViewportBounds = [
    halfViewportWidth * baseVoxelFactors[0] * relevantCoordinates[0],
    halfViewportWidth * baseVoxelFactors[1] * relevantCoordinates[1],
    halfViewportWidth * baseVoxelFactors[2] * relevantCoordinates[2],
  ];
  halfViewportBounds = V3.ceil(halfViewportBounds);
  return {
    min: V3.sub(position, halfViewportBounds),
    max: V3.add(position, halfViewportBounds),
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
  const zoom = yield* select(state => state.flycam.zoomStep);
  const baseVoxelFactors = yield* select(state =>
    Dimensions.transDim(getBaseVoxelFactors(state.dataset.dataSource.scale), activeViewport),
  );
  const halfViewportWidth = Math.round((Constants.PLANE_WIDTH / 2) * zoom);
  const [scaledOffsetX, scaledOffsetY] = baseVoxelFactors.map(f => halfViewportWidth * f);

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
  for (let x = tx - scaledOffsetX; x < tx + scaledOffsetX; x++) {
    for (let y = ty - scaledOffsetY; y < ty + scaledOffsetY; y++) {
      copyVoxelLabel(
        Dimensions.transDim([x, y, tz + direction * directionInverter], activeViewport),
        Dimensions.transDim([x, y, z], activeViewport),
      );
    }
  }
}

let segmentationModel = null;
function* getSegmentationModel(): Saga<Object> {
  if (segmentationModel == null) {
    console.time("fetch model");
    segmentationModel = yield* call(
      [tf, tf.loadModel],
      "http://localhost:9000/assets/bundle/seg-model.json",
    );
    console.timeEnd("fetch model");
  }
  return segmentationModel;
}

function* inferSegmentInViewport(action: InferSegmentationInViewportAction): Saga<void> {
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  const colorLayers = yield* call([Model, Model.getColorLayers]);
  const colorLayer = colorLayers[0];
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  // const zoom = yield* select(state => state.flycam.zoomStep);
  // const baseVoxelFactors = yield* select(state =>
  //   Dimensions.transDim(getBaseVoxelFactors(state.dataset.dataSource.scale), activeViewport),
  // );
  // const halfViewportWidth = Math.round((Constants.PLANE_WIDTH / 2) * zoom);
  // const [scaledOffsetX, scaledOffsetY] = baseVoxelFactors.map(f => halfViewportWidth * f);
  // const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);

  const outputExtent = 100;
  const overflowBufferSize = 92;
  const inputExtent = outputExtent + 2 * overflowBufferSize;
  const inputExtentHalf = inputExtent / 2;
  const halfVec = [inputExtentHalf, inputExtentHalf, 0];

  console.time("fetch cuboid");
  const min = V3.sub(position, halfVec);
  const max = V3.add(V3.add(position, halfVec), [0, 0, 1]);
  const cuboidData = yield* call([api.data, api.data.getDataFor2DBoundingBox], colorLayer.name, {
    min,
    max,
  });
  // const cuboidData = yield* call([api, api.data.getDataFor2DBoundingBox], { min, max });
  console.timeEnd("fetch cuboid");
  console.log("cuboidData", cuboidData);

  // const sliceBuffer = [];
  const [tx, ty, tz] = Dimensions.transDim(position, activeViewport);
  const z = tz;
  // for (let x = tx - inputExtentHalf; x < tx + inputExtentHalf; x++) {
  //   const row = [];
  //   for (let y = ty - inputExtentHalf; y < ty + inputExtentHalf; y++) {
  //     const voxelAddress = Dimensions.transDim([x, y, z], activeViewport);
  //     const voxelValue = colorLayer.cube.getDataValue(voxelAddress);
  //     // row.push(currentCellId === activeCellId ? 1 : 0);
  //     row.push([(voxelValue - 128) / 128]);
  //   }
  //   sliceBuffer.push(row);
  // }
  // const tensor = tf.tensor4d([sliceBuffer]);
  const scaledData = new Float32Array(new Uint8Array(cuboidData)).map(el => (el - 128) / 128);

  if (scaledData.length !== inputExtent ** 2) {
    console.warn("missing buckets");
    return;
  }

  let tensor = tf.tensor4d(scaledData, [1, inputExtent, inputExtent, 1]);
  tensor = tf.transpose(tensor, [0, 2, 1, 3]);

  const model = yield* call(getSegmentationModel);
  const inferredTensor = model.predict(tensor);

  const inferredData = yield* call([inferredTensor, inferredTensor.data]);

  let idx = 0;
  for (let x = tx - outputExtent / 2; x < tx + outputExtent / 2; x++) {
    for (let y = ty - outputExtent / 2; y < ty + outputExtent / 2; y++) {
      const voxelAddress = Dimensions.transDim([x, y, z], activeViewport);
      api.data.labelVoxels([voxelAddress], Math.round(inferredData[idx]));
      idx++;
    }
  }
}

export function* finishLayer(
  layer: VolumeLayer,
  activeTool: VolumeTool,
  contourTracingMode: ContourMode,
): Saga<void> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (activeTool === VolumeToolEnum.TRACE) {
    const start = Date.now();

    layer.finish();
    yield* call(labelWithIterator, layer.getVoxelIterator(), contourTracingMode);

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

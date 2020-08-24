// @flow
import _ from "lodash";

import {
  type CopySegmentationLayerAction,
  resetContourAction,
  updateDirectionAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  type Saga,
  _take,
  _takeEvery,
  _takeLeading,
  call,
  fork,
  put,
  race,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import {
  type UpdateAction,
  updateVolumeTracing,
  updateUserBoundingBoxes,
} from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import type { VolumeTracing, Flycam } from "oxalis/store";
import {
  enforceVolumeTracing,
  isVolumeTracingDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import {
  type BoundingBoxType,
  type ContourMode,
  ContourModeEnum,
  type OrthoView,
  type VolumeTool,
  type Vector2,
  type Vector3,
  VolumeToolEnum,
} from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Toast from "libs/toast";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import api from "oxalis/api/internal_api";
import inferSegmentInViewport, {
  getHalfViewportExtents,
} from "oxalis/model/sagas/automatic_brush_saga";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
  yield _takeLeading("INFER_SEGMENT_IN_VIEWPORT", inferSegmentInViewport);
  yield* fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Saga<void> {
  yield* take("INITIALIZE_SETTINGS");
  if (yield* select(state => state.tracing.volume == null)) {
    return;
  }
  const segmentationLayerName = yield* call([Model, Model.getSegmentationLayerName]);
  if (!segmentationLayerName) {
    return;
  }
  const isOpacityTooLow = yield* select(
    state => state.datasetConfiguration.layers[segmentationLayerName].alpha < 10,
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
    const isDrawing =
      contourTracingMode === ContourModeEnum.DRAW_OVERWRITE ||
      contourTracingMode === ContourModeEnum.DRAW;

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
      if (
        activeTool === VolumeToolEnum.TRACE ||
        (activeTool === VolumeToolEnum.BRUSH && isDrawing)
      ) {
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

function* getBoundingsFromPosition(currentViewport: OrthoView): Saga<BoundingBoxType> {
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
  let direction = 1;
  const useDynamicSpaceDirection = yield* select(
    state => state.userConfiguration.dynamicSpaceDirection,
  );
  if (useDynamicSpaceDirection) {
    const spaceDirectionOrtho = yield* select(state => state.flycam.spaceDirectionOrtho);
    const dim = Dimensions.getIndices(activeViewport)[2];
    direction = spaceDirectionOrtho[dim];
  }

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

export function* floodFill(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const floodFillAction = yield* take("FLOOD_FILL");
    if (floodFillAction.type !== "FLOOD_FILL") {
      throw new Error("Unexpected action. Satisfy flow.");
    }
    const { position, planeId } = floodFillAction;
    const segmentationLayer = yield* call([Model, Model.getSegmentationLayer]);
    const { cube } = segmentationLayer;
    const initialVoxel = Dimensions.roundCoordinate(position);
    const activeViewport = yield* select(state => state.viewModeData.plane.activeViewport);
    const currentViewportBounding = yield* call(getBoundingsFromPosition, activeViewport);
    const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
    const thirdDimIndex = Dimensions.thirdDimensionForPlane(planeId);
    const dimensionsToIterateOver: Vector2 = ([0, 1, 2].filter(val => val !== thirdDimIndex): any);
    const get3DAddress = (voxel: Vector2, initialAddress: Vector3) => {
      let index2d = 0;
      const res = [0, 0, 0];

      for (let i = 0; i <= 2; i++) {
        if (i !== thirdDimIndex) {
          res[i] = voxel[index2d++];
        } else {
          res[i] = initialAddress[thirdDimIndex];
        }
      }
      return res;
    };
    const get2DAddress = (voxel: Vector3): Vector2 => {
      const res = [0, 0];
      let counter = 0;
      for (let i = 0; i < 3; ++i) {
        if (i !== thirdDimIndex) {
          res[counter++] = voxel[i];
        }
      }
      return res;
    };
    cube.floodFill(
      initialVoxel,
      activeCellId,
      get3DAddress,
      get2DAddress,
      dimensionsToIterateOver,
      currentViewportBounding,
    );
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

  if (activeTool === VolumeToolEnum.TRACE || activeTool === VolumeToolEnum.BRUSH) {
    yield* call(labelWithIterator, layer.getVoxelIterator(activeTool), contourTracingMode);
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
  if (!_.isEqual(prevVolumeTracing.userBoundingBoxes, volumeTracing.userBoundingBoxes)) {
    yield updateUserBoundingBoxes(volumeTracing.userBoundingBoxes);
  }
}

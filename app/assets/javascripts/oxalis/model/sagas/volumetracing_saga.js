/**
 * volumetracing_saga.js
 * @flow
 */
import {
  call,
  select,
  put,
  take,
  _take,
  race,
  _takeEvery,
  fork,
} from "oxalis/model/sagas/effect-generators";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import {
  updateDirectionAction,
  resetContourAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { CopySegmentationLayerAction } from "oxalis/model/actions/volumetracing_actions";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import Dimensions from "oxalis/model/dimensions";
import { getPosition, getRotation } from "oxalis/model/accessors/flycam_accessor";
import {
  enforceVolumeTracing,
  isVolumeTracingDisallowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import { updateVolumeTracing } from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import Model from "oxalis/model";
import Constants, { VolumeToolEnum, ContourModeEnum, OrthoViews } from "oxalis/constants";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type {
  OrthoView,
  VolumeTool,
  ContourMode,
  BoundingBox,
} from "oxalis/constants";
import type { VolumeTracing, Flycam } from "oxalis/store";
import api from "oxalis/api/internal_api";

export function* watchVolumeTracingAsync(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
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
      // if the current viewport does not match the initial viewport -> dont draw
      if (initialViewport !== (yield* select(state => state.viewModeData.plane.activeViewport))) {
        continue;
      }
      if (activeTool === VolumeToolEnum.TRACE) {
        currentLayer.addContour(addToLayerAction.position);
      } else if (activeTool === VolumeToolEnum.BRUSH) {
        const currentViewportBounding = yield* call(getBoundingsFromPosition, initialViewport);
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

function* getBoundingsFromPosition(currentViewport: OrthoView): Saga<?BoundingBox> {
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const zoom = yield* select(state => state.flycam.zoomStep);
  const scales = yield* select(state => getBaseVoxelFactors(state.dataset.dataSource.scale));
  const halfViewportWidth = Math.round((Constants.PLANE_WIDTH / 2) * zoom);
  let relevantCoordinates;
  switch (currentViewport) {
    case OrthoViews.PLANE_XY:
      relevantCoordinates = [1, 1, 0];
      break;
    case OrthoViews.PLANE_YZ:
      relevantCoordinates = [0, 1, 1];
      break;
    case OrthoViews.PLANE_XZ:
      relevantCoordinates = [1, 0, 1];
      break;
    default:
      return null;
  }
  let halfViewportBounds = [
    halfViewportWidth * scales[0] * relevantCoordinates[0],
    halfViewportWidth * scales[1] * relevantCoordinates[1],
    halfViewportWidth * scales[2] * relevantCoordinates[2],
  ];
  halfViewportBounds = halfViewportBounds.map(value => Math.ceil(value));
  return {
    min: [
      position[0] - halfViewportBounds[0],
      position[1] - halfViewportBounds[1],
      position[2] - halfViewportBounds[2],
    ],
    max: [
      position[0] + halfViewportBounds[0],
      position[1] + halfViewportBounds[1],
      position[2] + halfViewportBounds[2],
    ],
  };
}

function* createVolumeLayer(planeId: OrthoView): Saga<VolumeLayer> {
  const position = Dimensions.roundCoordinate(yield* select(state => getPosition(state.flycam)));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}

function* labelWithIterator(iterator, contourTracingMode): Saga<void> {
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

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracing,
  volumeTracing: VolumeTracing,
  flycam: Flycam,
): Generator<UpdateAction, void, void> {
  // no diffing happening here (yet) as for volume tracings there are only updateTracing actions so far
  yield updateVolumeTracing(
    volumeTracing,
    V3.floor(getPosition(flycam)),
    getRotation(flycam),
    flycam.zoomStep,
  );
}

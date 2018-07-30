/**
 * volumetracing_saga.js
 * @flow
 */
import { call, select, put, take, race, takeEvery, fork } from "redux-saga/effects";
import {
  updateDirectionAction,
  resetContourAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { CopySegmentationLayerActionType } from "oxalis/model/actions/volumetracing_actions";
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
import Constants, { VolumeToolEnum, ContourModeEnum } from "oxalis/constants";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { OrthoViewType, VolumeToolType, ContourModeType } from "oxalis/constants";
import type { OxalisState, VolumeTracingType, FlycamType } from "oxalis/store";
import api from "oxalis/api/internal_api";

export function* watchVolumeTracingAsync(): Generator<*, *, *> {
  yield take("WK_READY");
  yield takeEvery("COPY_SEGMENTATION_LAYER", copySegmentationLayer);
  yield fork(warnOfTooLowOpacity);
}

function* warnOfTooLowOpacity(): Generator<*, *, *> {
  yield take("INITIALIZE_SETTINGS");
  if (yield select((state: OxalisState) => state.tracing.volume == null)) {
    return;
  }

  const isOpacityTooLow = yield select(
    (state: OxalisState) => state.datasetConfiguration.segmentationOpacity < 10,
  );
  if (isOpacityTooLow) {
    Toast.warning(
      'Your setting for "segmentation opacity" is set very low.<br />Increase it for better visibility while volume tracing.',
    );
  }
}

export function* editVolumeLayerAsync(): Generator<any, any, any> {
  yield take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield select((state: OxalisState) => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield take("START_EDITING");
    const contourTracingMode = yield select(
      (state: OxalisState) => enforceVolumeTracing(state.tracing).contourTracingMode,
    );

    // Volume tracing for higher zoomsteps is currently not allowed
    if (yield select((state: OxalisState) => isVolumeTracingDisallowed(state))) {
      continue;
    }
    const currentLayer = yield call(createVolumeLayer, startEditingAction.planeId);
    const activeTool = yield select(
      (state: OxalisState) => enforceVolumeTracing(state.tracing).activeTool,
    );

    if (activeTool === VolumeToolEnum.BRUSH) {
      yield labelWithIterator(
        currentLayer.getCircleVoxelIterator(startEditingAction.position),
        contourTracingMode,
      );
    }

    while (true) {
      const { addToLayerAction, finishEditingAction } = yield race({
        addToLayerAction: take("ADD_TO_LAYER"),
        finishEditingAction: take("FINISH_EDITING"),
      });

      if (finishEditingAction) break;

      if (activeTool === VolumeToolEnum.TRACE) {
        currentLayer.addContour(addToLayerAction.position);
      } else if (activeTool === VolumeToolEnum.BRUSH) {
        yield labelWithIterator(
          currentLayer.getCircleVoxelIterator(addToLayerAction.position),
          contourTracingMode,
        );
      }
    }

    yield call(finishLayer, currentLayer, activeTool, contourTracingMode);
  }
}

function* createVolumeLayer(planeId: OrthoViewType): Generator<*, *, *> {
  const position = Dimensions.roundCoordinate(
    yield select((state: OxalisState) => getPosition(state.flycam)),
  );
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}

function* labelWithIterator(iterator, contourTracingMode): Generator<*, *, *> {
  const activeCellId = yield select(
    (state: OxalisState) => enforceVolumeTracing(state.tracing).activeCellId,
  );
  const segmentationLayer = yield call([Model, Model.getSegmentationLayer]);
  const { cube } = segmentationLayer;
  switch (contourTracingMode) {
    case ContourModeEnum.DRAW_OVERWRITE:
      yield call([cube, cube.labelVoxels], iterator, activeCellId);
      break;
    case ContourModeEnum.DRAW:
      yield call([cube, cube.labelVoxels], iterator, activeCellId, 0);
      break;
    case ContourModeEnum.DELETE_FROM_ACTIVE_CELL:
      yield call([cube, cube.labelVoxels], iterator, 0, activeCellId);
      break;
    case ContourModeEnum.DELETE_FROM_ANY_CELL:
      yield call([cube, cube.labelVoxels], iterator, 0);
      break;
    default:
      throw new Error("Invalid volume tracing mode.");
  }
}

function* copySegmentationLayer(action: CopySegmentationLayerActionType): Generator<*, *, *> {
  const activeViewport = yield select(
    (state: OxalisState) => state.viewModeData.plane.activeViewport,
  );
  if (activeViewport === "TDView") {
    // Cannot copy labels from 3D view
    return;
  }

  const segmentationLayer = yield call([Model, Model.getSegmentationLayer]);
  const position = Dimensions.roundCoordinate(
    yield select((state: OxalisState) => getPosition(state.flycam)),
  );
  const zoom = yield select((state: OxalisState) => state.flycam.zoomStep);
  const halfViewportWidth = Math.round((Constants.PLANE_WIDTH / 2) * zoom);
  const activeCellId = yield select(
    (state: OxalisState) => enforceVolumeTracing(state.tracing).activeCellId,
  );

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
  const spaceDirectionOrtho = yield select(
    (state: OxalisState) => state.flycam.spaceDirectionOrtho,
  );
  const dim = Dimensions.getIndices(activeViewport)[2];
  const direction = spaceDirectionOrtho[dim];

  const [tx, ty, tz] = Dimensions.transDim(position, activeViewport);
  const z = tz;
  for (let x = tx - halfViewportWidth; x < tx + halfViewportWidth; x++) {
    for (let y = ty - halfViewportWidth; y < ty + halfViewportWidth; y++) {
      copyVoxelLabel(
        Dimensions.transDim([x, y, tz + direction * directionInverter], activeViewport),
        Dimensions.transDim([x, y, z], activeViewport),
      );
    }
  }
}

export function* finishLayer(
  layer: VolumeLayer,
  activeTool: VolumeToolType,
  contourTracingMode: ContourModeType,
): Generator<*, *, *> {
  if (layer == null || layer.isEmpty()) {
    return;
  }

  if (activeTool === VolumeToolEnum.TRACE) {
    const start = Date.now();

    layer.finish();
    yield labelWithIterator(layer.getVoxelIterator(), contourTracingMode);

    console.log("Labeling time:", Date.now() - start);
  }

  yield put(updateDirectionAction(layer.getCentroid()));
  yield put(resetContourAction());
}

export function* disallowVolumeTracingWarning(): Generator<*, *, *> {
  while (true) {
    yield take(["SET_TOOL", "CYCLE_TOOL"]);
    if (yield select((state: OxalisState) => isVolumeTracingDisallowed(state))) {
      Toast.warning("Volume tracing is not possible at this zoom level. Please zoom in further.");
    }
  }
}

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracingType,
  volumeTracing: VolumeTracingType,
  flycam: FlycamType,
): Generator<UpdateAction, *, *> {
  // no diffing happening here (yet) as for volume tracings there are only updateTracing actions so far
  yield updateVolumeTracing(
    volumeTracing,
    V3.floor(getPosition(flycam)),
    getRotation(flycam),
    flycam.zoomStep,
  );
}

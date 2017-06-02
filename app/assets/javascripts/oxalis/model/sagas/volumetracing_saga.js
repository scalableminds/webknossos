/**
 * volumetracing_saga.js
 * @flow
 */
import app from "app";
import { call, select, put, take, race, takeEvery } from "redux-saga/effects";
import { updateDirectionAction, resetContourAction } from "oxalis/model/actions/volumetracing_actions";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import Dimensions from "oxalis/model/dimensions";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { isVolumeTracingDisallowed, getActiveCellId } from "oxalis/model/accessors/volumetracing_accessor";
import { updateVolumeTracing } from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import Model from "oxalis/model";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { OrthoViewType } from "oxalis/constants";
import type { VolumeTracingType, FlycamType } from "oxalis/store";

export function* updateIsosurface(): Generator<*, *, *> {
  const shouldDisplayIsosurface = yield select(state => state.userConfiguration.isosurfaceDisplay);
  const activeCellIdMaybe = yield select(state => getActiveCellId(state.tracing));

  if (shouldDisplayIsosurface) {
    activeCellIdMaybe.map(activeCellId =>
      // $FlowFixMe
      app.oxalis.sceneController.renderVolumeIsosurface(activeCellId),
    );
  }
}

export function* watchVolumeTracingAsync(): Generator<*, *, *> {
  yield take("WK_READY");
  yield takeEvery(["FINISH_EDITING"], updateIsosurface);
}

export function* editVolumeLayerAsync(): Generator<*, *, *> {
  const allowUpdate = yield select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield take("START_EDITING");

    // Volume tracing for higher zoomsteps is currently not allowed
    if (yield select(state => isVolumeTracingDisallowed(state))) {
      continue;
    }
    const currentLayer = yield call(createVolumeLayer, startEditingAction.planeId);

    let abortEditing = false;
    while (true) {
      const { addToLayerAction, finishEditingAction, createCellAction } = yield race({
        addToLayerAction: take("ADD_TO_LAYER"),
        finishEditingAction: take("FINISH_EDITING"),
        createCellAction: take("CREATE_CELL_ACTION"),
      });

      // If a cell is created while drawing a contour, abort the editing process
      if (createCellAction) abortEditing = true;
      if (finishEditingAction || createCellAction) break;

      currentLayer.addContour(addToLayerAction.position);
    }

    if (abortEditing) continue;

    yield call(finishLayer, currentLayer);
  }
}

function* createVolumeLayer(planeId: OrthoViewType): Generator<*, *, *> {
  const position = Dimensions.roundCoordinate(yield select(state => getPosition(state.flycam)));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}


export function* finishLayer(layer: VolumeLayer): Generator<*, *, *> {
  if ((layer == null) || layer.isEmpty()) {
    return;
  }

  const start = Date.now();
  layer.finish();
  const iterator = layer.getVoxelIterator();
  const labelValue = yield select(state => state.tracing.activeCellId);
  if (app.oxalis) {
    const binary = yield call([Model, Model.getSegmentationBinary]);
    yield call([binary.cube, binary.cube.labelVoxels], iterator, labelValue);
  }
  console.log("Labeling time:", (Date.now() - start));

  yield put(updateDirectionAction(layer.getCentroid()));
  yield put(resetContourAction());
}


export function* disallowVolumeTracingWarning(): Generator<*, *, *> {
  while (true) {
    yield take(["SET_MODE", "TOGGLE_MODE"]);
    if (yield select(state => isVolumeTracingDisallowed(state))) {
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
  );
}

/**
 * volumetracing_saga.js
 * @flow
 */
import app from "app";
import { call, select, put, take, race } from "redux-saga/effects";
import { updateDirectionAction, resetContourAction } from "oxalis/model/actions/volumetracing_actions";
import VolumeLayer from "oxalis/model/volumetracing/volumelayer";
import Dimensions from "oxalis/model/dimensions";
import { getPosition, getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { updateVolumeTracing } from "oxalis/model/sagas/update_actions";
import { V3 } from "libs/mjs";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { OrthoViewType } from "oxalis/constants";
import type { VolumeTracingType, FlycamType } from "oxalis/store";

export function* editVolumeLayerAsync(): Generator<*, *, *> {
  const allowUpdate = yield select(state => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const startEditingAction = yield take("START_EDITING");

    // Volume tracing for higher zoomsteps is currently not allowed
    if (yield select(state => getIntegerZoomStep(state) > 1)) {
      break;
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

    if (abortEditing) break;

    yield call(finishLayer, currentLayer);
  }
}

function* createVolumeLayer(planeId: OrthoViewType) {
  const position = Dimensions.roundCoordinate(yield select(state => getPosition(state.flycam)));
  const thirdDimValue = position[Dimensions.thirdDimensionForPlane(planeId)];
  return new VolumeLayer(planeId, thirdDimValue);
}


export function* finishLayer(layer: VolumeLayer) {
  if ((layer == null) || layer.isEmpty()) {
    return;
  }

  const start = (new Date()).getTime();
  layer.finish();
  const iterator = layer.getVoxelIterator();
  const labelValue = yield select(state => state.tracing.activeCellId);
  if (app.oxalis) {
    const binary = yield call([app.oxalis.model, app.oxalis.model.getSegmentationBinary]);
    yield call([binary.cube, binary.cube.labelVoxels], iterator, labelValue);
  }
  console.log("Labeling time:", ((new Date()).getTime() - start));

  yield put(updateDirectionAction(layer.getCentroid()));
  yield put(resetContourAction());
}

export function* diffVolumeTracing(
  prevVolumeTracing: VolumeTracingType,
  volumeTracing: VolumeTracingType,
  flycam: FlycamType,
): Generator<UpdateAction, *, *> {
  yield updateVolumeTracing(
    volumeTracing,
    V3.floor(getPosition(flycam)),
  );
}

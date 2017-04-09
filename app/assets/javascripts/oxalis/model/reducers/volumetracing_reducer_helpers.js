/**
 * volumetracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import type { OxalisState, VolumeTracingType, VolumeCellType } from "oxalis/store";
import type { VolumeModeType, Vector3 } from "oxalis/constants";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
import update from "immutability-helper";
import { getIntegerZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { setRotationReducer } from "oxalis/model/reducers/flycam_reducer";

export function setModeReducer(state: OxalisState, volumeTracing: VolumeTracingType, mode: VolumeModeType) {
  if (mode === volumeTracing.viewMode) {
    return state;
  }
  if (mode === Constants.VOLUME_MODE_TRACE && getIntegerZoomStep(state) > 1) {
    Toast.warning("Volume tracing is not possible at this zoom level. Please zoom in further.");
    return state;
  }

  return update(state, { tracing: {
    viewMode: { $set: mode },
  } });
}

export function setActiveCellReducer(state: OxalisState, volumeTracing: VolumeTracingType, id: number) {
  const newActiveCell = volumeTracing.cells[id];

  if ((newActiveCell == null) && id > 0) {
    return createCellReducer(state, volumeTracing, id);
  }

  return update(state, { tracing: {
    activeCellId: { $set: id },
  } });
}

export function createCellReducer(state: OxalisState, volumeTracing: VolumeTracingType, id: ?number) {
  let newIdCount = volumeTracing.idCount;
  if (id == null) {
    id = newIdCount++;
  }

  // Create the new VolumeCell
  const cell: VolumeCellType = { id };

  return update(state, { tracing: {
    activeCellId: { $set: cell.id },
    cells: { [cell.id]: { $set: cell } },
    idCount: { $set: newIdCount },
  } });
}

export function updateDirectionReducer(state: OxalisState, volumeTracing: VolumeTracingType, centroid: Vector3) {
  let newState = state;
  if (volumeTracing.lastCentroid != null) {
    newState = setRotationReducer(state, [
      centroid[0] - volumeTracing.lastCentroid[0],
      centroid[1] - volumeTracing.lastCentroid[1],
      centroid[2] - volumeTracing.lastCentroid[2],
    ]);
  }
  return update(newState, { tracing: {
    lastCentroid: { $set: centroid },
  } });
}

export function addToLayerReducer(state: OxalisState, volumeTracing: VolumeTracingType, position: Vector3) {
  return update(state, { tracing: {
    contourList: { $push: [position] },
  } });
}

export function resetContourReducer(state: OxalisState) {
  return update(state, { tracing: {
    contourList: { $set: [] },
  } });
}

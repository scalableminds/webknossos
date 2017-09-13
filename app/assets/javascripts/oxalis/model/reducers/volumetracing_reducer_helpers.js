/**
 * volumetracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import type { OxalisState, VolumeTracingType, VolumeCellType } from "oxalis/store";
import type { VolumeToolType, Vector3 } from "oxalis/constants";
import { VolumeToolEnum } from "oxalis/constants";
import update from "immutability-helper";
import { isVolumeTracingDisallowed } from "oxalis/model/accessors/volumetracing_accessor";
import { setDirectionReducer } from "oxalis/model/reducers/flycam_reducer";

export function setToolReducer(
  state: OxalisState,
  volumeTracing: VolumeTracingType,
  tool: VolumeToolType,
) {
  if (tool === volumeTracing.activeTool) {
    return state;
  }
  if (tool !== VolumeToolEnum.MOVE && isVolumeTracingDisallowed(state)) {
    return state;
  }

  return update(state, {
    tracing: {
      activeTool: { $set: tool },
    },
  });
}

export function setActiveCellReducer(
  state: OxalisState,
  volumeTracing: VolumeTracingType,
  id: number,
) {
  const newActiveCell = volumeTracing.cells[id];

  if (newActiveCell == null && id > 0) {
    return createCellReducer(state, volumeTracing, id);
  }

  return update(state, {
    tracing: {
      activeCellId: { $set: id },
    },
  });
}

export function createCellReducer(
  state: OxalisState,
  volumeTracing: VolumeTracingType,
  id: ?number,
) {
  if (id === 0) {
    // cellId 0 means there is no annotation, so there must not be a cell with id 0
    return state;
  }
  let newMaxCellId = volumeTracing.maxCellId;
  if (id == null) {
    newMaxCellId++;
    id = newMaxCellId;
  } else {
    newMaxCellId = Math.max(id, newMaxCellId);
  }

  // Create the new VolumeCell
  const cell: VolumeCellType = { id };

  return update(state, {
    tracing: {
      activeCellId: { $set: cell.id },
      cells: { [cell.id]: { $set: cell } },
      maxCellId: { $set: newMaxCellId },
    },
  });
}

export function updateDirectionReducer(
  state: OxalisState,
  volumeTracing: VolumeTracingType,
  centroid: Vector3,
) {
  let newState = state;
  if (volumeTracing.lastCentroid != null) {
    newState = setDirectionReducer(state, [
      centroid[0] - volumeTracing.lastCentroid[0],
      centroid[1] - volumeTracing.lastCentroid[1],
      centroid[2] - volumeTracing.lastCentroid[2],
    ]);
  }
  return update(newState, {
    tracing: {
      lastCentroid: { $set: centroid },
    },
  });
}

export function addToLayerReducer(
  state: OxalisState,
  volumeTracing: VolumeTracingType,
  position: Vector3,
) {
  const { allowUpdate } = state.tracing.restrictions;
  if (!allowUpdate || isVolumeTracingDisallowed(state)) {
    return state;
  }

  return update(state, {
    tracing: {
      contourList: { $push: [position] },
    },
  });
}

export function resetContourReducer(state: OxalisState) {
  return update(state, {
    tracing: {
      contourList: { $set: [] },
    },
  });
}

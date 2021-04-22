/**
 * volumetracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import update from "immutability-helper";

import { type ContourMode, type Vector3 } from "oxalis/constants";
import type { OxalisState, VolumeTracing, VolumeCell } from "oxalis/store";
import { setDirectionReducer } from "oxalis/model/reducers/flycam_reducer";
import { isVolumeAnnotationDisallowedForZoom } from "oxalis/model/accessors/volumetracing_accessor";

export function setActiveCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id: number) {
  const newActiveCell = volumeTracing.cells[id];

  if (newActiveCell == null && id > 0) {
    return createCellReducer(state, volumeTracing, id);
  }

  return update(state, {
    tracing: {
      volume: {
        activeCellId: { $set: id },
      },
    },
  });
}

export function createCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id?: number) {
  if (id === 0) {
    // cellId 0 means there is no annotation, so there must not be a cell with id 0
    return state;
  }

  // The maxCellId is only updated if a voxel using that id was annotated. Therefore, it can happen
  // that the activeCellId is larger than the maxCellId. Choose the larger of the two ids and increase it by one.
  const { activeCellId, maxCellId } = volumeTracing;
  if (id == null) {
    id = Math.max(activeCellId, maxCellId) + 1;
  }

  if (volumeTracing.cells[id] == null) {
    // Create the new VolumeCell
    const cell: VolumeCell = { id };

    return update(state, {
      tracing: {
        volume: {
          activeCellId: { $set: id },
          cells: { [id]: { $set: cell } },
        },
      },
    });
  } else {
    return update(state, {
      tracing: {
        volume: {
          activeCellId: { $set: id },
        },
      },
    });
  }
}

export function updateDirectionReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
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
      volume: {
        lastCentroid: { $set: centroid },
      },
    },
  });
}

export function addToLayerReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  position: Vector3,
) {
  const { restrictions } = state.tracing;
  const { allowUpdate } = restrictions;
  if (!allowUpdate || isVolumeAnnotationDisallowedForZoom(state.uiInformation.activeTool, state)) {
    return state;
  }

  return update(state, {
    tracing: {
      volume: {
        contourList: { $push: [position] },
      },
    },
  });
}

export function resetContourReducer(state: OxalisState) {
  return update(state, {
    tracing: {
      volume: {
        contourList: { $set: [] },
      },
    },
  });
}

export function hideBrushReducer(state: OxalisState) {
  return update(state, {
    temporaryConfiguration: { mousePosition: { $set: null } },
  });
}

export function setContourTracingModeReducer(state: OxalisState, mode: ContourMode) {
  return update(state, {
    tracing: {
      volume: {
        contourTracingMode: { $set: mode },
      },
    },
  });
}

export function setMaxCellReducer(state: OxalisState, id: number) {
  return update(state, {
    tracing: {
      volume: {
        maxCellId: { $set: id },
      },
    },
  });
}

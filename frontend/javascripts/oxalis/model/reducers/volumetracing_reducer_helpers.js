// @flow
import update from "immutability-helper";

import { type ContourMode, type Vector3 } from "oxalis/constants";
import type { OxalisState, VolumeTracing } from "oxalis/store";
import { isVolumeAnnotationDisallowedForZoom } from "oxalis/model/accessors/volumetracing_accessor";
import { setDirectionReducer } from "oxalis/model/reducers/flycam_reducer";
import { updateKey } from "oxalis/model/helpers/deep_update";

function updateVolumeTracing(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  shape: $Shape<VolumeTracing>,
) {
  const newVolumes = state.tracing.volumes.map(volume => {
    if (volume.tracingId === volumeTracing.tracingId) {
      return {
        ...volumeTracing,
        ...shape,
      };
    } else {
      return volume;
    }
  });

  return updateKey(state, "tracing", {
    volumes: newVolumes,
  });
}

export function setActiveCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id: number) {
  return updateVolumeTracing(state, volumeTracing, {
    activeCellId: id,
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

  return updateVolumeTracing(state, volumeTracing, {
    activeCellId: id,
  });
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
  return updateVolumeTracing(newState, volumeTracing, {
    lastCentroid: centroid,
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

  return updateVolumeTracing(state, volumeTracing, {
    contourList: [position],
  });
}

export function resetContourReducer(state: OxalisState, volumeTracing: VolumeTracing) {
  return updateVolumeTracing(state, volumeTracing, {
    contourList: [],
  });
}

export function hideBrushReducer(state: OxalisState) {
  return update(state, {
    temporaryConfiguration: { mousePosition: { $set: null } },
  });
}

export function setContourTracingModeReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  mode: ContourMode,
) {
  return updateVolumeTracing(state, volumeTracing, {
    contourTracingMode: mode,
  });
}

export function setMaxCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id: number) {
  return updateVolumeTracing(state, volumeTracing, {
    maxCellId: id,
  });
}

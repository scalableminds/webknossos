import update from "immutability-helper";
import { ContourMode, OrthoViews, OrthoViewWithoutTD, Vector3 } from "oxalis/constants";
import type { LabelAction, OxalisState, VolumeTracing } from "oxalis/store";
import { isVolumeAnnotationDisallowedForZoom } from "oxalis/model/accessors/volumetracing_accessor";
import { setDirectionReducer } from "oxalis/model/reducers/flycam_reducer";
import { updateKey } from "oxalis/model/helpers/deep_update";
export function updateVolumeTracing(
  state: OxalisState,
  volumeTracingId: string,
  shape: Partial<VolumeTracing>,
) {
  const newVolumes = state.tracing.volumes.map((volume) => {
    if (volume.tracingId === volumeTracingId) {
      return { ...volume, ...shape };
    } else {
      return volume;
    }
  });
  return updateKey(state, "tracing", {
    volumes: newVolumes,
  });
}
export function setActiveCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id: number) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
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

  return updateVolumeTracing(state, volumeTracing.tracingId, {
    activeCellId: id,
  });
}

const MAXIMUM_LABEL_ACTIONS_COUNT = 50;
export function updateDirectionReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  centroid: Vector3,
) {
  let newState = state;

  const lastCentroid = volumeTracing.lastLabelActions[0]?.centroid;
  if (lastCentroid != null) {
    newState = setDirectionReducer(state, [
      centroid[0] - lastCentroid[0],
      centroid[1] - lastCentroid[1],
      centroid[2] - lastCentroid[2],
    ]);
  }

  const plane: OrthoViewWithoutTD =
    state.viewModeData.plane.activeViewport != OrthoViews.TDView
      ? state.viewModeData.plane.activeViewport
      : OrthoViews.PLANE_XY;

  const labelAction: LabelAction = { centroid, plane };

  return updateVolumeTracing(newState, volumeTracing.tracingId, {
    lastLabelActions: [labelAction]
      .concat(volumeTracing.lastLabelActions)
      .slice(0, MAXIMUM_LABEL_ACTIONS_COUNT),
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

  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourList: [...volumeTracing.contourList, position],
  });
}
export function resetContourReducer(state: OxalisState, volumeTracing: VolumeTracing) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourList: [],
  });
}
export function hideBrushReducer(state: OxalisState) {
  return update(state, {
    temporaryConfiguration: {
      mousePosition: {
        $set: null,
      },
    },
  });
}
export function setContourTracingModeReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  mode: ContourMode,
) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourTracingMode: mode,
  });
}
export function setMaxCellReducer(state: OxalisState, volumeTracing: VolumeTracing, id: number) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    maxCellId: id,
  });
}

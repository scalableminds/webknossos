import update from "immutability-helper";
import {
  type ContourMode,
  type OrthoViewWithoutTD,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import {
  getSegmentationLayerForTracing,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";
import { updateKey } from "oxalis/model/helpers/deep_update";
import { setDirectionReducer } from "oxalis/model/reducers/flycam_reducer";
import type {
  EditableMapping,
  LabelAction,
  MappingType,
  OxalisState,
  SegmentGroup,
  SegmentMap,
  VolumeTracing,
} from "oxalis/store";
import { isInSupportedValueRangeForLayer } from "../accessors/dataset_accessor";
import { mapGroupsToGenerator } from "../accessors/skeletontracing_accessor";

export function updateVolumeTracing(
  state: OxalisState,
  volumeTracingId: string,
  shape: Partial<VolumeTracing>,
) {
  const newVolumes = state.annotation.volumes.map((volume) => {
    if (volume.tracingId === volumeTracingId) {
      return { ...volume, ...shape };
    } else {
      return volume;
    }
  });
  return updateKey(state, "annotation", {
    volumes: newVolumes,
  });
}
export function updateEditableMapping(
  state: OxalisState,
  volumeTracingId: string,
  shape: Partial<EditableMapping>,
) {
  const newMappings = state.annotation.mappings.map((mapping) => {
    if (mapping.tracingId === volumeTracingId) {
      return { ...mapping, ...shape };
    } else {
      return mapping;
    }
  });
  return updateKey(state, "annotation", {
    mappings: newMappings,
  });
}
export function setActiveCellReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  id: number,
  activeUnmappedSegmentId: number | null | undefined,
) {
  const segmentationLayer = getSegmentationLayerForTracing(state, volumeTracing);

  if (!isInSupportedValueRangeForLayer(state.dataset, segmentationLayer.name, id)) {
    // Ignore the action if the segment id is not valid for the current elementClass
    return state;
  }
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    activeCellId: id,
    activeUnmappedSegmentId,
  });
}
export function createCellReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  newSegmentId: number,
) {
  return setActiveCellReducer(state, volumeTracing, newSegmentId, null);
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
    state.viewModeData.plane.activeViewport !== OrthoViews.TDView
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
  const { allowUpdate } = state.annotation.restrictions;

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
export function setLargestSegmentIdReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  id: number,
) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    largestSegmentId: id,
  });
}
export function setMappingNameReducer(
  state: OxalisState,
  volumeTracing: VolumeTracing,
  mappingName: string | null | undefined,
  mappingType: MappingType,
  isMappingEnabled: boolean = true,
) {
  /*
   * This function is responsible for updating the mapping name in the volume
   * tracing object (which is also persisted on the back-end). Only null
   * or the name of a HDF5 mapping is stored there, though.
   */
  // Editable mappings or locked mappings cannot be disabled or switched for now
  if (volumeTracing.hasEditableMapping || volumeTracing.mappingIsLocked) {
    return state;
  }

  // Clear the name for Non-HDF5 mappings or when the mapping got disabled,
  // before persisting the name in volume annotations. JSON mappings are
  // not stored in the back-end for now.
  if (mappingType !== "HDF5" || !isMappingEnabled) {
    mappingName = null;
  }

  return updateVolumeTracing(state, volumeTracing.tracingId, {
    mappingName,
  });
}

export function removeMissingGroupsFromSegments(
  volumeTracing: VolumeTracing,
  segmentGroups: Array<SegmentGroup>,
): SegmentMap {
  // Change the groupId of segments for groups that no longer exist
  const groupIds = new Set(mapGroupsToGenerator(segmentGroups, (group) => group.groupId));
  const newSegments = volumeTracing.segments.clone();
  let hasChanged = false;
  for (const [segmentId, segment] of volumeTracing.segments.entries()) {
    if (segment.groupId != null && !groupIds.has(segment.groupId)) {
      hasChanged = true;
      newSegments.mutableSet(segmentId, { ...segment, groupId: null });
    }
  }
  // Avoid changing the identity when it's not needed.
  return hasChanged ? newSegments : volumeTracing.segments;
}

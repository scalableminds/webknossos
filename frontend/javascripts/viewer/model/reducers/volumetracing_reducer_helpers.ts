import update from "immutability-helper";
import {
  type ContourMode,
  type OrthoViewWithoutTD,
  OrthoViews,
  type Vector3,
} from "viewer/constants";
import {
  getRequestedOrVisibleSegmentationLayer,
  getSegmentationLayerForTracing,
  getVolumeTracingById,
  isVolumeAnnotationDisallowedForZoom,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateKey, updateKey2 } from "viewer/model/helpers/deep_update";
import { setDirectionReducer } from "viewer/model/reducers/flycam_reducer";
import type {
  EditableMapping,
  LabelAction,
  MappingType,
  SegmentGroup,
  SegmentMap,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import { isInSupportedValueRangeForLayer } from "../accessors/dataset_accessor";
import { mapGroupsToGenerator } from "../accessors/skeletontracing_accessor";
import type {
  FinishMappingInitializationAction,
  SetMappingAction,
  SetMappingEnabledAction,
  SetMappingNameAction,
} from "../actions/settings_actions";
import type { VolumeTracingAction } from "../actions/volumetracing_actions";
import type { TreeGroup } from "../types/tree_types";
import { forEachGroups } from "./skeletontracing_reducer_helpers";

export type VolumeTracingReducerAction =
  | VolumeTracingAction
  | SetMappingAction
  | FinishMappingInitializationAction
  | SetMappingEnabledAction
  | SetMappingNameAction;

export function updateVolumeTracing(
  state: WebknossosState,
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
  state: WebknossosState,
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
  state: WebknossosState,
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
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  newSegmentId: number,
) {
  return setActiveCellReducer(state, volumeTracing, newSegmentId, null);
}

const MAXIMUM_LABEL_ACTIONS_COUNT = 50;
export function updateDirectionReducer(
  state: WebknossosState,
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
export function addToContourListReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  positionInLayerSpace: Vector3,
) {
  const { isUpdatingCurrentlyAllowed } = state.annotation;

  if (
    !isUpdatingCurrentlyAllowed ||
    isVolumeAnnotationDisallowedForZoom(state.uiInformation.activeTool, state)
  ) {
    return state;
  }

  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourList: [...volumeTracing.contourList, positionInLayerSpace],
  });
}
export function resetContourReducer(state: WebknossosState, volumeTracing: VolumeTracing) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourList: [],
  });
}
export function hideBrushReducer(state: WebknossosState) {
  return update(state, {
    temporaryConfiguration: {
      mousePosition: {
        $set: null,
      },
    },
  });
}
export function setContourTracingModeReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  mode: ContourMode,
) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    contourTracingMode: mode,
  });
}
export function setLargestSegmentIdReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  id: number | null,
) {
  return updateVolumeTracing(state, volumeTracing.tracingId, {
    largestSegmentId: id,
  });
}
export function setMappingNameReducer(
  state: WebknossosState,
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
  if (mappingType === "JSON" || mappingType == null || !isMappingEnabled) {
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

type SegmentUpdateInfo =
  | {
      readonly type: "UPDATE_VOLUME_TRACING";
      readonly volumeTracing: VolumeTracing;
      readonly segments: SegmentMap;
      readonly segmentGroups: TreeGroup[];
    }
  | {
      readonly type: "UPDATE_LOCAL_SEGMENTATION_DATA";
      readonly layerName: string;
      readonly segments: SegmentMap;
      readonly segmentGroups: [];
    }
  | {
      readonly type: "NOOP";
    };

export function getSegmentUpdateInfo(
  state: WebknossosState,
  layerName: string | null | undefined,
): SegmentUpdateInfo {
  // Returns an object describing how to update a segment in the specified layer.
  const layer = getRequestedOrVisibleSegmentationLayer(state, layerName);

  if (!layer) {
    return {
      type: "NOOP",
    };
  }

  if (layer.tracingId != null) {
    const volumeTracing = getVolumeTracingById(state.annotation, layer.tracingId);
    return {
      type: "UPDATE_VOLUME_TRACING",
      volumeTracing,
      segments: volumeTracing.segments,
      segmentGroups: volumeTracing.segmentGroups,
    };
  } else {
    return {
      type: "UPDATE_LOCAL_SEGMENTATION_DATA",
      layerName: layer.name,
      segments: state.localSegmentationData[layer.name].segments,
      segmentGroups: [],
    };
  }
}

export function setSegmentGroups(
  state: WebknossosState,
  layerName: string,
  newSegmentGroups: SegmentGroup[],
) {
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type === "NOOP") {
    return state;
  }

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    // In case a group is deleted which still has segments attached to it,
    // adapt the segments so that they belong to the root group. This is
    // done to avoid that segments get lost in nirvana if the segment groups
    // were updated inappropriately.
    const fixedSegments = removeMissingGroupsFromSegments(
      updateInfo.volumeTracing,
      newSegmentGroups,
    );
    return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
      segments: fixedSegments,
      segmentGroups: newSegmentGroups,
    });
  }

  // Don't update groups for non-tracings
  return state;
}

export function updateSegments(
  state: WebknossosState,
  layerName: string,
  mapFn: (segments: SegmentMap) => SegmentMap,
) {
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type === "NOOP") {
    return state;
  }

  const { segments } =
    updateInfo.type === "UPDATE_VOLUME_TRACING"
      ? updateInfo.volumeTracing
      : state.localSegmentationData[updateInfo.layerName];

  const newSegmentMap = mapFn(segments);

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
      segments: newSegmentMap,
    });
  }

  // Update localSegmentationData
  return updateKey2(state, "localSegmentationData", updateInfo.layerName, {
    segments: newSegmentMap,
  });
}

export function toggleSegmentGroupReducer(
  state: WebknossosState,
  layerName: string,
  groupId: number,
  targetVisibility?: boolean,
): WebknossosState {
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type === "NOOP") {
    return state;
  }
  const { segments, segmentGroups } = updateInfo;

  let toggledGroup;
  forEachGroups(segmentGroups, (group) => {
    if (group.groupId === groupId) toggledGroup = group;
  });
  if (toggledGroup == null) return state;
  // Assemble a list that contains the toggled groupId and the groupIds of all child groups
  const affectedGroupIds = new Set(mapGroupsToGenerator([toggledGroup], (group) => group.groupId));
  // Let's make all segments visible if there is one invisible segment in one of the affected groups
  const shouldBecomeVisible =
    targetVisibility != null
      ? targetVisibility
      : Array.from(segments.values()).some(
          (segment) =>
            typeof segment.groupId === "number" &&
            affectedGroupIds.has(segment.groupId) &&
            !segment.isVisible,
        );

  const newSegments = segments.clone();

  Array.from(segments.values()).forEach((segment) => {
    if (typeof segment.groupId === "number" && affectedGroupIds.has(segment.groupId)) {
      newSegments.mutableSet(segment.id, { ...segment, isVisible: shouldBecomeVisible });
    }
  });

  return updateSegments(state, layerName, (_oldSegments) => newSegments);
}

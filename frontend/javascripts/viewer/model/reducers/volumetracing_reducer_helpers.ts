import update from "immutability-helper";
import { floor3 } from "libs/utils";
import groupBy from "lodash-es/groupBy";
import isEqual from "lodash-es/isEqual";
import uniqBy from "lodash-es/uniqBy";
import uniqWith from "lodash-es/uniqWith";
import type { Writeable } from "types/type_utils";
import {
  type ContourMode,
  OrthoViews,
  type OrthoViewWithoutTD,
  type Vector3,
} from "viewer/constants";
import {
  getRequestedOrVisibleSegmentationLayer,
  getSegmentationLayerForTracing,
  getSegmentName,
  getSelectedIds,
  getVisibleSegments,
  getVolumeTracingById,
  isVolumeAnnotationDisallowedForZoom,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateKey, updateKey2 } from "viewer/model/helpers/deep_update";
import { setDirectionReducer } from "viewer/model/reducers/flycam_reducer";
import type {
  LabelAction,
  MappingType,
  Segment,
  SegmentGroup,
  SegmentMap,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import {
  findParentIdForGroupId,
  mapGroups,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import {
  getLayerByName,
  getVisibleSegmentationLayer,
  isInSupportedValueRangeForLayer,
} from "../accessors/dataset_accessor";
import { mapGroupsToGenerator } from "../accessors/skeletontracing_accessor";
import type {
  FinishMappingInitializationAction,
  SetMappingAction,
  SetMappingEnabledAction,
  SetMappingNameAction,
} from "../actions/settings_actions";
import {
  type ClickSegmentAction,
  type MergeSegmentItemsAction,
  type RemoveSegmentAction,
  removeSegmentAction,
  type SetSegmentsAction,
  type UpdateSegmentAction,
  updateSegmentAction,
  type VolumeTracingAction,
} from "../actions/volumetracing_actions";
import type { TreeGroup } from "../types/tree_types";
import { sanitizeMetadata } from "./skeletontracing_reducer";
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

function removeMissingGroupsFromSegments(
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

export function handleSetSegments(state: WebknossosState, action: SetSegmentsAction) {
  const { segments, layerName } = action;
  return updateSegments(state, layerName, (_oldSegments) => segments);
}

export function handleRemoveSegment(state: WebknossosState, action: RemoveSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => segments.delete(action.segmentId));
}

export function handleUpdateSegment(state: WebknossosState, action: UpdateSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => {
    const { segmentId, segment } = action;
    if (segmentId === 0) {
      return segments;
    }
    const oldSegment = segments.getNullable(segmentId);

    const newSegment: Writeable<Segment> = {
      id: segmentId,
      // If oldSegment exists, its creationTime will be
      // used by ...oldSegment
      creationTime: action.timestamp,
      name: null,
      color: null,
      isVisible: true,
      groupId: getSelectedIds(state).group,
      metadata: [],
      ...oldSegment,
      ...segment,
    };

    if (newSegment.anchorPosition) {
      newSegment.anchorPosition = floor3(newSegment.anchorPosition);
    } else {
      // UPDATE_SEGMENT was called for a non-existing segment without providing
      // a position. This is necessary to define custom colors for segments
      // which are listed in a JSON mapping. The action will store the segment
      // without a position.
    }
    newSegment.metadata = sanitizeMetadata(newSegment.metadata);

    const newSegmentMap = segments.set(segmentId, newSegment);
    return newSegmentMap;
  });
}

export function handleMergeSegments(state: WebknossosState, action: MergeSegmentItemsAction) {
  const updateInfo = getSegmentUpdateInfo(state, action.layerName);
  if (updateInfo.type !== "UPDATE_VOLUME_TRACING") {
    return state;
  }
  const { volumeTracing } = updateInfo;
  const { segments } = volumeTracing;
  const sourceSegment = segments.getNullable(action.sourceAgglomerateId);
  const targetSegment = segments.getNullable(action.targetAgglomerateId);

  let newState = handleRemoveSegment(
    state,
    removeSegmentAction(action.targetAgglomerateId, action.layerName),
  );
  const entryIndex = (volumeTracing.segmentJournal.at(-1)?.entryIndex ?? -1) + 1;

  newState = updateVolumeTracing(newState, volumeTracing.tracingId, {
    segmentJournal: volumeTracing.segmentJournal.concat([
      {
        type: "MERGE_SEGMENTS_ITEMS",
        agglomerateId1: action.sourceAgglomerateId,
        agglomerateId2: action.targetAgglomerateId,
        segmentId1: action.sourceSegmentId,
        segmentId2: action.targetSegmentId,
        entryIndex,
      },
    ]),
  });

  const updatedSourceProps = getUpdatedSourcePropsAfterMerge(
    action.sourceAgglomerateId,
    action.targetAgglomerateId,
    sourceSegment,
    targetSegment,
  );

  // Even when updatedSourceProps is empty, the following statement is important
  // because there might be no segment item for agglomerateId1, yet. In that case,
  // it will be created here.
  newState = handleUpdateSegment(
    newState,
    updateSegmentAction(action.sourceAgglomerateId, updatedSourceProps, action.layerName),
  );

  return newState;
}

export function getUpdatedSourcePropsAfterMerge(
  sourceId: number,
  targetId: number,
  sourceSegment: Segment | undefined,
  targetSegment: Segment | undefined,
) {
  // Since the target segment is deleted (absorbed by the source segment),
  // we should ensure that no information is lost.
  // However, this is only necessary when the targetSegment is not null.
  if (targetSegment == null) {
    return {};
  }
  const props: Writeable<Partial<Segment>> = {};
  // Handle `name` by concatening names
  if (targetSegment.name != null && targetSegment.name !== "") {
    // The new segments name should always start with the original
    // source segment's name. Therefore, we use getSegmentName
    // so that we have a fallback even when no source segment existed.
    // This is because of cases like this:
    // Source segment: {id: 1, name: null}
    // Target segment: {id: 2, name: "Segment 2 - Custom String"}
    // Without the fallback logic, the new segment 1 would simply be
    // "Segment 2 - Custom String" which would be confusing because of the
    // id mismatch.
    // The below logic produces this instead:
    // {id: 1, name: "Segment 1 and Segment 2 - Custom String"}.
    const sourceName = getSegmentName(sourceSegment ?? { id: sourceId, name: undefined }, false);
    props.name = `${sourceName} and ${targetSegment.name}`;
  }

  // Handle metadata by concatenating the entries. Special care is taken
  // to ensure that the keys are still unique.
  // If both metadata entry sets use a key twice, this "conflict" is used
  // by checking whether their values are equal. If so, only one metadata
  // entry is regarded.
  // If the values are not equal, the keys are postfixed like this: key-originalSegmentId.
  // Have a look at the "should merge two segments (simple)" unit test for an example.
  if (targetSegment.metadata.length > 0) {
    const sourceMetadata = sourceSegment?.metadata ?? [];
    const mergedMetadataEntries = sourceMetadata.concat(targetSegment.metadata);
    // Items of mergedMetadataEntries with index < pivotIndex,
    // belong to the source segment. The other belong to the
    // target segment.
    const pivotIndex = sourceMetadata.length;
    const keyToEntries = groupBy(mergedMetadataEntries, (entry) => entry.key);
    const metadataEntriesWithUniqueKeys = uniqBy(
      mergedMetadataEntries.map((entry, index) => {
        const valuesForKeys = keyToEntries[entry.key];
        if (valuesForKeys.length > 1) {
          const uniqValues = uniqWith(valuesForKeys, isEqual);
          if (uniqValues.length > 1) {
            const originalSegmentId = index < pivotIndex ? sourceId : targetId;
            return {
              ...entry,
              // Postfix the key to make it unique.
              key: `${entry.key}-${originalSegmentId}`,
            };
          }
        }
        return entry;
      }),
      (entry) => entry.key,
    );
    props.metadata = metadataEntriesWithUniqueKeys;
  }

  // For some properties, the data in source segment should simply "win".
  // However, if the source item didn't exist before, we use the data from targetSegment.
  if (sourceSegment == null) {
    if (targetSegment.anchorPosition != null) {
      props.anchorPosition = targetSegment.anchorPosition;
    }
    if (targetSegment.additionalCoordinates != null) {
      props.additionalCoordinates = targetSegment.additionalCoordinates;
    }
    if (targetSegment.groupId != null) {
      props.groupId = targetSegment.groupId;
    }
  }

  return props;
}

export function expandSegmentParents(state: WebknossosState, action: ClickSegmentAction) {
  const maybeVolumeLayer =
    action.layerName != null
      ? getLayerByName(state.dataset, action.layerName)
      : getVisibleSegmentationLayer(state);

  const layerName = maybeVolumeLayer?.name;
  if (layerName == null) return state;

  const getNewGroups = () => {
    const { segments, segmentGroups } = getVisibleSegments(state);
    if (segments == null) return segmentGroups;
    const { segmentId } = action;
    const segmentForId = segments.getNullable(segmentId);
    if (segmentForId == null) return segmentGroups;
    // Expand recursive parents of group too, if necessary
    const pathToRoot = new Set([segmentForId.groupId]);
    if (segmentForId.groupId != null) {
      let currentParent = findParentIdForGroupId(segmentGroups, segmentForId.groupId);
      while (currentParent != null) {
        pathToRoot.add(currentParent);
        currentParent = findParentIdForGroupId(segmentGroups, currentParent);
      }
    }
    return mapGroups(segmentGroups, (group) => {
      if (pathToRoot.has(group.groupId) && !group.isExpanded) {
        return { ...group, isExpanded: true };
      }
      return group;
    });
  };
  return setSegmentGroups(state, layerName, getNewGroups());
}

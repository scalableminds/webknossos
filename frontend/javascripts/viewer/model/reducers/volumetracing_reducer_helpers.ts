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
  LocalSegmentationState,
  MappingType,
  Segment,
  SegmentGroup,
  SegmentMap,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import {
  createGroupHelper,
  findGroup,
  findParentIdForGroupId,
  MISSING_GROUP_ID,
  mapGroups,
} from "viewer/view/right_border_tabs/trees_tab/tree_hierarchy_view_helpers";
import {
  getLayerByName,
  getVisibleSegmentationLayer,
  isInSupportedValueRangeForLayer,
} from "../accessors/dataset_accessor";
import { mapGroupsToGenerator } from "../accessors/skeletontracing_accessor";
import type { SetIdReservationsAction } from "../actions/actions";
import type {
  FinishMappingInitializationAction,
  SetMappingAction,
  SetMappingDataAction,
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
  | SetMappingDataAction
  | FinishMappingInitializationAction
  | SetMappingEnabledAction
  | SetMappingNameAction
  | SetIdReservationsAction;

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

export function updateLocalSegmentationState(
  state: WebknossosState,
  layerName: string,
  shape: Partial<LocalSegmentationState>,
) {
  // Note that for volume tracing layers, the layerName is the tracingId.
  return updateKey2(state, "localSegmentationStateByLayer", layerName, shape);
}

export function setActiveCellReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  id: bigint,
  activeUnmappedSegmentId: bigint | null | undefined,
) {
  const segmentationLayer = getSegmentationLayerForTracing(state, volumeTracing);

  if (!isInSupportedValueRangeForLayer(state.dataset, segmentationLayer.name, id)) {
    // Ignore the action if the segment id is not valid for the current elementClass
    return state;
  }
  const newState = updateVolumeTracing(state, volumeTracing.tracingId, {
    activeCellId: id,
  });
  return updateLocalSegmentationState(newState, volumeTracing.tracingId, {
    activeUnmappedSegmentId,
  });
}
export function createCellReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  newSegmentId: bigint,
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

  const lastLabelActions =
    state.localSegmentationStateByLayer[volumeTracing.tracingId]?.lastLabelActions ?? [];
  const lastCentroid = lastLabelActions[0]?.centroid;
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

  return updateLocalSegmentationState(newState, volumeTracing.tracingId, {
    lastLabelActions: [labelAction].concat(lastLabelActions).slice(0, MAXIMUM_LABEL_ACTIONS_COUNT),
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

  const contourList =
    state.localSegmentationStateByLayer[volumeTracing.tracingId]?.contourList ?? [];
  return updateLocalSegmentationState(state, volumeTracing.tracingId, {
    contourList: [...contourList, positionInLayerSpace],
  });
}
export function resetContourReducer(state: WebknossosState, volumeTracing: VolumeTracing) {
  return updateLocalSegmentationState(state, volumeTracing.tracingId, {
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
  return updateLocalSegmentationState(state, volumeTracing.tracingId, {
    contourTracingMode: mode,
  });
}
export function setLargestSegmentIdReducer(
  state: WebknossosState,
  volumeTracing: VolumeTracing,
  id: bigint | null,
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
  // Editable mappings or locked mappings cannot be disabled or switched for now.
  if (volumeTracing.hasEditableMapping || volumeTracing.mappingIsLocked) {
    return state;
  }

  // If the name wouldn't change there is not need to update.
  if (volumeTracing.mappingName === mappingName) {
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

export function getGroupIdSet(segmentGroups: Array<SegmentGroup>) {
  return new Set(mapGroupsToGenerator(segmentGroups, (group) => group.groupId));
}

function removeMissingGroupsFromSegments(
  volumeTracing: VolumeTracing,
  segmentGroups: Array<SegmentGroup>,
): SegmentMap {
  // Change the groupId of segments for groups that no longer exist
  const groupIds = getGroupIdSet(segmentGroups);
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
      readonly type: "UPDATE_LOCAL_SEGMENTATION_STATE";
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
      type: "UPDATE_LOCAL_SEGMENTATION_STATE",
      layerName: layer.name,
      segments: state.localSegmentationStateByLayer[layer.name].segments,
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

export function addSegmentGroupReducer(
  state: WebknossosState,
  layerName: string,
  id: number,
  name: string | null,
  parentGroupId: number | null,
) {
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type !== "UPDATE_VOLUME_TRACING") {
    return state;
  }

  const { segmentGroups } = updateInfo.volumeTracing;
  // Assert that the id is not already used by an existing group.
  if (!findGroup(segmentGroups, id) == null) {
    throw new Error(`Requested creation of group with id ${id} which is already in use.`);
  }

  const newSegmentGroups = createGroupHelper(
    segmentGroups,
    name,
    id,
    parentGroupId ?? MISSING_GROUP_ID,
  );
  return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
    segmentGroups: newSegmentGroups,
  });
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
      : state.localSegmentationStateByLayer[updateInfo.layerName];

  const newSegmentMap = mapFn(segments);

  if (updateInfo.type === "UPDATE_VOLUME_TRACING") {
    return updateVolumeTracing(state, updateInfo.volumeTracing.tracingId, {
      segments: newSegmentMap,
    });
  }

  // Update localSegmentationStateByLayer
  return updateKey2(state, "localSegmentationStateByLayer", updateInfo.layerName, {
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
  return updateSegments(state, action.layerName, (segments) =>
    // TODO: Proper 64 bit support (#6921)
    segments.delete(BigInt(action.segmentId)),
  );
}

export function handleUpdateSegment(state: WebknossosState, action: UpdateSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => {
    // TODO: Proper 64 bit support (#6921)
    const segmentId = BigInt(action.segmentId);
    const { segment } = action;
    if (segmentId === 0n) {
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
  // TODO: Proper 64 bit support (#6921)
  const sourceAgglomerateId = BigInt(action.sourceAgglomerateId);
  const targetAgglomerateId = BigInt(action.targetAgglomerateId);
  const sourceSegmentId = BigInt(action.sourceSegmentId);
  const targetSegmentId = BigInt(action.targetSegmentId);
  const isSameAgglomerate = sourceAgglomerateId === targetAgglomerateId;
  const sourceSegment = segments.getNullable(sourceAgglomerateId);
  const targetSegment = segments.getNullable(targetAgglomerateId);

  // If the agglomerates are equal, do not remove the entry as this would empty the whole segment information.
  // This can happen in a concurrent editing scenario of the same segment.
  // Usually the later users client would notice a duplicate merge operation, be we do not want to rely on this here.
  let newState = isSameAgglomerate
    ? state
    : handleRemoveSegment(state, removeSegmentAction(targetAgglomerateId, action.layerName));
  const entryIndex = (volumeTracing.segmentJournal.at(-1)?.entryIndex ?? -1) + 1;

  newState = updateVolumeTracing(newState, volumeTracing.tracingId, {
    segmentJournal: volumeTracing.segmentJournal.concat([
      {
        type: "MERGE_SEGMENTS_ITEMS",
        agglomerateId1: sourceAgglomerateId,
        agglomerateId2: targetAgglomerateId,
        segmentId1: sourceSegmentId,
        segmentId2: targetSegmentId,
        entryIndex,
      },
    ]),
  });

  const updatedSourceProps = getUpdatedSourcePropsAfterMerge(
    sourceAgglomerateId,
    targetAgglomerateId,
    sourceSegment,
    targetSegment,
  );

  // Even when updatedSourceProps is empty, the following statement is important
  // because there might be no segment item for agglomerateId1, yet. In that case,
  // it will be created here.
  newState = handleUpdateSegment(
    newState,
    updateSegmentAction(sourceAgglomerateId, updatedSourceProps, action.layerName),
  );

  return newState;
}

export function getUpdatedSourcePropsAfterMerge(
  sourceId: bigint,
  targetId: bigint,
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
  // Handle `name` by concatenating names
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
    const sourceName = getSegmentName(
      sourceSegment != null
        ? { id: sourceSegment.id, name: sourceSegment.name }
        : { id: sourceId, name: undefined },
      false,
    );
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

  // For some properties, the data in source segment should simply "win" if the data
  // exists. If the source segment doesn't have the data, we can use the target segment's
  // data.
  if (sourceSegment?.anchorPosition == null && targetSegment.anchorPosition != null) {
    props.anchorPosition = targetSegment.anchorPosition;
    // Since additionalCoordinates always refers to the anchorPosition, we need to set
    // both here. For that reason, the if-condition doesn't need to check the
    // additionalCoordinates property itself.
    props.additionalCoordinates = targetSegment.additionalCoordinates;
  }
  if (sourceSegment?.groupId == null && targetSegment.groupId != null) {
    props.groupId = targetSegment.groupId;
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
    // TODO: Proper 64 bit support (#6921)
    const segmentId = BigInt(action.segmentId);
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

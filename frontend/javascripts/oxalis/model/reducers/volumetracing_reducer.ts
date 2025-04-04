import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import * as Utils from "libs/utils";
import { ContourModeEnum } from "oxalis/constants";
import {
  getLayerByName,
  getMappingInfo,
  getMaximumSegmentIdForLayer,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getRequestedOrVisibleSegmentationLayer,
  getSegmentationLayerForTracing,
  getSelectedIds,
  getVisibleSegments,
  getVolumeTracingById,
} from "oxalis/model/accessors/volumetracing_accessor";
import type {
  FinishMappingInitializationAction,
  SetMappingAction,
  SetMappingEnabledAction,
  SetMappingNameAction,
} from "oxalis/model/actions/settings_actions";
import type {
  ClickSegmentAction,
  RemoveSegmentAction,
  SetSegmentsAction,
  UpdateSegmentAction,
  VolumeTracingAction,
} from "oxalis/model/actions/volumetracing_actions";
import { updateKey2 } from "oxalis/model/helpers/deep_update";
import {
  convertServerAdditionalAxesToFrontEnd,
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "oxalis/model/reducers/reducer_helpers";
import {
  addToLayerReducer,
  createCellReducer,
  hideBrushReducer,
  removeMissingGroupsFromSegments,
  resetContourReducer,
  setActiveCellReducer,
  setContourTracingModeReducer,
  setLargestSegmentIdReducer,
  setMappingNameReducer,
  updateDirectionReducer,
  updateVolumeTracing,
} from "oxalis/model/reducers/volumetracing_reducer_helpers";
import type {
  EditableMapping,
  OxalisState,
  Segment,
  SegmentGroup,
  SegmentMap,
  VolumeTracing,
} from "oxalis/store";
import {
  findParentIdForGroupId,
  getGroupNodeKey,
} from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import type { AdditionalCoordinate, ServerVolumeTracing } from "types/api_flow_types";
import { mapGroups } from "../accessors/skeletontracing_accessor";
import { sanitizeMetadata } from "./skeletontracing_reducer";

type SegmentUpdateInfo =
  | {
      readonly type: "UPDATE_VOLUME_TRACING";
      readonly volumeTracing: VolumeTracing;
    }
  | {
      readonly type: "UPDATE_LOCAL_SEGMENTATION_DATA";
      readonly layerName: string;
    }
  | {
      readonly type: "NOOP";
    };

function getSegmentUpdateInfo(
  state: OxalisState,
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
    };
  } else {
    return {
      type: "UPDATE_LOCAL_SEGMENTATION_DATA",
      layerName: layer.name,
    };
  }
}

function updateSegments(
  state: OxalisState,
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

function setSegmentGroups(state: OxalisState, layerName: string, newSegmentGroups: SegmentGroup[]) {
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

function handleSetSegments(state: OxalisState, action: SetSegmentsAction) {
  const { segments, layerName } = action;
  return updateSegments(state, layerName, (_oldSegments) => segments);
}

function handleRemoveSegment(state: OxalisState, action: RemoveSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => segments.delete(action.segmentId));
}

function handleUpdateSegment(state: OxalisState, action: UpdateSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => {
    const { segmentId, segment } = action;
    const oldSegment = segments.getNullable(segmentId);

    let somePosition;
    let someAdditionalCoordinates: AdditionalCoordinate[] | undefined | null;
    if (segment.somePosition) {
      somePosition = Utils.floor3(segment.somePosition);
      someAdditionalCoordinates = segment.someAdditionalCoordinates;
    } else if (oldSegment != null) {
      somePosition = oldSegment.somePosition;
      someAdditionalCoordinates = oldSegment.someAdditionalCoordinates;
    } else {
      // UPDATE_SEGMENT was called for a non-existing segment without providing
      // a position. This is necessary to define custom colors for segments
      // which are listed in a JSON mapping. The action will store the segment
      // without a position.
    }

    const metadata = sanitizeMetadata(segment.metadata || oldSegment?.metadata || []);

    const newSegment: Segment = {
      // If oldSegment exists, its creationTime will be
      // used by ...oldSegment
      creationTime: action.timestamp,
      name: null,
      color: null,
      groupId: getSelectedIds(state)[0].group,
      someAdditionalCoordinates: someAdditionalCoordinates,
      ...oldSegment,
      ...segment,
      metadata,
      somePosition,
      id: segmentId,
    };

    const newSegmentMap = segments.set(segmentId, newSegment);
    return newSegmentMap;
  });
}

function expandSegmentParents(state: OxalisState, action: ClickSegmentAction) {
  if (action.layerName == null) return state;
  const getNewGroups = () => {
    const { segments, segmentGroups } = getVisibleSegments(state);
    if (action.layerName == null || segments == null) return segmentGroups;
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
  return setSegmentGroups(state, action.layerName, getNewGroups());
}

export function serverVolumeToClientVolumeTracing(tracing: ServerVolumeTracing): VolumeTracing {
  // As the frontend doesn't know all cells, we have to keep track of the highest id
  // and cannot compute it
  const largestSegmentId = tracing.largestSegmentId;
  const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(tracing.userBoundingBoxes);
  const volumeTracing = {
    createdTimestamp: tracing.createdTimestamp,
    type: "volume" as const,
    segments: new DiffableMap(
      tracing.segments.map((segment) => [
        segment.segmentId,
        {
          ...segment,
          id: segment.segmentId,
          somePosition: segment.anchorPosition
            ? Utils.point3ToVector3(segment.anchorPosition)
            : undefined,
          someAdditionalCoordinates: segment.additionalCoordinates,
          color: segment.color != null ? Utils.colorObjectToRGBArray(segment.color) : null,
        } as Segment,
      ]),
    ),
    segmentGroups: tracing.segmentGroups || [],
    activeCellId: tracing.activeSegmentId ?? 0,
    lastLabelActions: [],
    contourTracingMode: ContourModeEnum.DRAW,
    contourList: [],
    largestSegmentId,
    tracingId: tracing.id,
    boundingBox: convertServerBoundingBoxToFrontend(tracing.boundingBox),
    fallbackLayer: tracing.fallbackLayer,
    userBoundingBoxes,
    mappingName: tracing.mappingName,
    hasEditableMapping: tracing.hasEditableMapping,
    mappingIsLocked: tracing.mappingIsLocked,
    volumeBucketDataHasChanged: tracing.volumeBucketDataHasChanged,
    hasSegmentIndex: tracing.hasSegmentIndex || false,
    additionalAxes: convertServerAdditionalAxesToFrontEnd(tracing.additionalAxes),
  };
  return volumeTracing;
}

type VolumeTracingReducerAction =
  | VolumeTracingAction
  | SetMappingAction
  | FinishMappingInitializationAction
  | SetMappingEnabledAction
  | SetMappingNameAction;

function getVolumeTracingFromAction(state: OxalisState, action: VolumeTracingReducerAction) {
  if ("tracingId" in action && action.tracingId != null) {
    return getVolumeTracingById(state.annotation, action.tracingId);
  }
  const maybeVolumeLayer =
    "layerName" in action && action.layerName != null
      ? getLayerByName(state.dataset, action.layerName)
      : getVisibleSegmentationLayer(state);

  if (
    maybeVolumeLayer == null ||
    !("tracingId" in maybeVolumeLayer) ||
    maybeVolumeLayer.tracingId == null
  ) {
    return null;
  }
  return getVolumeTracingById(state.annotation, maybeVolumeLayer.tracingId);
}

function VolumeTracingReducer(state: OxalisState, action: VolumeTracingReducerAction): OxalisState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const volumeTracing = serverVolumeToClientVolumeTracing(action.tracing);
      const newVolumes = state.annotation.volumes.filter(
        (tracing) => tracing.tracingId !== volumeTracing.tracingId,
      );
      newVolumes.push(volumeTracing);
      const newState = update(state, {
        annotation: {
          volumes: {
            $set: newVolumes,
          },
        },
      });

      if (volumeTracing.largestSegmentId != null && volumeTracing.activeCellId === 0) {
        // If a largest segment id is known but the active cell is 0,
        // and does not overflow the segmentation layers maximum possible segment id,
        // we can automatically create a new segment ID for the user.
        const segmentationLayer = getSegmentationLayerForTracing(newState, volumeTracing);
        const newSegmentId = volumeTracing.largestSegmentId + 1;
        if (newSegmentId > getMaximumSegmentIdForLayer(newState.dataset, segmentationLayer.name)) {
          // If the new segment ID would overflow the maximum segment ID, simply set the active cell to largestSegmentId.
          return setActiveCellReducer(
            newState,
            volumeTracing,
            volumeTracing.largestSegmentId,
            null,
          );
        } else {
          return createCellReducer(newState, volumeTracing, volumeTracing.largestSegmentId + 1);
        }
      }

      return newState;
    }

    case "INITIALIZE_EDITABLE_MAPPING": {
      const mapping: EditableMapping = {
        type: "mapping",
        ...action.mapping,
      };
      const newMappings = state.annotation.mappings.filter(
        (tracing) => tracing.tracingId !== mapping.tracingId,
      );
      newMappings.push(mapping);
      return update(state, {
        annotation: {
          mappings: {
            $set: newMappings,
          },
        },
      });
    }

    case "SET_SEGMENTS": {
      return handleSetSegments(state, action);
    }

    case "UPDATE_SEGMENT": {
      return handleUpdateSegment(state, action);
    }

    case "REMOVE_SEGMENT": {
      return handleRemoveSegment(state, action);
    }

    case "SET_EXPANDED_SEGMENT_GROUPS": {
      const { expandedSegmentGroups, layerName } = action;
      const { segmentGroups } = getVisibleSegments(state);
      const newGroups = mapGroups(segmentGroups, (group) => {
        const shouldBeExpanded = expandedSegmentGroups.has(getGroupNodeKey(group.groupId));
        if (shouldBeExpanded !== group.isExpanded) {
          return {
            ...group,
            isExpanded: shouldBeExpanded,
          };
        } else {
          return group;
        }
      });
      return setSegmentGroups(state, layerName, newGroups);
    }

    case "SET_SEGMENT_GROUPS": {
      const { segmentGroups } = action;
      return setSegmentGroups(state, action.layerName, segmentGroups);
    }

    case "CLICK_SEGMENT": {
      return expandSegmentParents(state, action);
    }

    case "SET_VOLUME_BUCKET_DATA_HAS_CHANGED": {
      return updateVolumeTracing(state, action.tracingId, {
        volumeBucketDataHasChanged: true,
      });
    }

    default: // pass
  }

  if (state.annotation.volumes.length === 0) {
    // If no volume exists yet (i.e., it wasn't initialized, yet),
    // the following reducer code should not run.
    return state;
  }

  const volumeTracing = getVolumeTracingFromAction(state, action);
  if (volumeTracing == null) {
    return state;
  }

  switch (action.type) {
    case "SET_ACTIVE_CELL": {
      return setActiveCellReducer(
        state,
        volumeTracing,
        action.segmentId,
        action.activeUnmappedSegmentId,
      );
    }

    case "CREATE_CELL": {
      return createCellReducer(state, volumeTracing, action.newSegmentId);
    }

    case "UPDATE_DIRECTION": {
      return updateDirectionReducer(state, volumeTracing, action.centroid);
    }

    case "ADD_TO_LAYER": {
      return addToLayerReducer(state, volumeTracing, action.position);
    }

    case "RESET_CONTOUR": {
      return resetContourReducer(state, volumeTracing);
    }

    case "HIDE_BRUSH": {
      return hideBrushReducer(state);
    }

    case "SET_CONTOUR_TRACING_MODE": {
      return setContourTracingModeReducer(state, volumeTracing, action.mode);
    }

    case "SET_LARGEST_SEGMENT_ID": {
      return setLargestSegmentIdReducer(state, volumeTracing, action.segmentId);
    }

    case "FINISH_ANNOTATION_STROKE": {
      // Possibly update the largestSegmentId after volume annotation
      const { activeCellId, largestSegmentId } = volumeTracing;
      if (largestSegmentId == null) {
        // If no largest segment id was known, we should not assume that
        // the used segment id is the highest one.
        return state;
      }
      return setLargestSegmentIdReducer(
        state,
        volumeTracing,
        Math.max(activeCellId, largestSegmentId),
      );
    }

    case "SET_MAPPING": {
      // We only need to store the name of the mapping here. Also see the settings_reducer where
      // SET_MAPPING is also handled.
      return setMappingNameReducer(state, volumeTracing, action.mappingName, action.mappingType);
    }
    case "FINISH_MAPPING_INITIALIZATION": {
      const { mappingName, mappingType } = getMappingInfo(
        state.temporaryConfiguration.activeMappingByLayer,
        action.layerName,
      );
      return setMappingNameReducer(state, volumeTracing, mappingName, mappingType, true);
    }

    case "SET_MAPPING_ENABLED": {
      const { mappingName, mappingType } = getMappingInfo(
        state.temporaryConfiguration.activeMappingByLayer,
        action.layerName,
      );
      return setMappingNameReducer(
        state,
        volumeTracing,
        mappingName,
        mappingType,
        action.isMappingEnabled,
      );
    }

    case "SET_MAPPING_NAME": {
      // Editable mappings cannot be disabled or switched for now
      if (volumeTracing.hasEditableMapping || volumeTracing.mappingIsLocked) return state;

      const { mappingName, mappingType } = action;
      return setMappingNameReducer(state, volumeTracing, mappingName, mappingType);
    }

    case "SET_HAS_EDITABLE_MAPPING": {
      // Editable mappings cannot be disabled or switched for now.
      if (volumeTracing.hasEditableMapping || volumeTracing.mappingIsLocked) return state;

      // An editable mapping is always locked.
      return updateVolumeTracing(state, volumeTracing.tracingId, {
        hasEditableMapping: true,
        mappingIsLocked: true,
      });
    }
    case "SET_MAPPING_IS_LOCKED": {
      if (volumeTracing.mappingIsLocked) return state;

      return updateVolumeTracing(state, volumeTracing.tracingId, {
        mappingIsLocked: true,
      });
    }

    default:
      return state;
  }
}

export default VolumeTracingReducer;

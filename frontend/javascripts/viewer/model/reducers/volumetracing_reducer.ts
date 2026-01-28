import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import { colorObjectToRGBArray, mapEntriesToMap, point3ToVector3, replaceOrAdd } from "libs/utils";
import type { APIUserBase, ServerVolumeTracing } from "types/api_types";
import { ContourModeEnum } from "viewer/constants";
import {
  getLayerByName,
  getMappingInfo,
  getMaximumSegmentIdForLayer,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getSegmentationLayerForTracing,
  getVisibleSegments,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import {} from "viewer/model/actions/volumetracing_actions";
import {
  applyUserStateToGroups,
  convertServerAdditionalAxesToFrontEnd,
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "viewer/model/reducers/reducer_helpers";
import {
  addToContourListReducer,
  createCellReducer,
  expandSegmentParents,
  getSegmentUpdateInfo,
  handleMergeSegments,
  handleRemoveSegment,
  handleSetSegments,
  handleUpdateSegment,
  hideBrushReducer,
  resetContourReducer,
  setActiveCellReducer,
  setContourTracingModeReducer,
  setLargestSegmentIdReducer,
  setMappingNameReducer,
  setSegmentGroups,
  toggleSegmentGroupReducer,
  updateDirectionReducer,
  updateSegments,
  updateVolumeTracing,
  type VolumeTracingReducerAction,
} from "viewer/model/reducers/volumetracing_reducer_helpers";
import type { EditableMapping, Segment, VolumeTracing, WebknossosState } from "viewer/store";
import {
  getGroupNodeKey,
  mapGroups,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { getUserStateForTracing } from "../accessors/annotation_accessor";
import { applyVolumeUpdateActionsFromServer } from "./update_action_application/volume";

export function serverVolumeToClientVolumeTracing(
  tracing: ServerVolumeTracing,
  activeUser: APIUserBase | null | undefined,
  owner: APIUserBase | null | undefined,
): VolumeTracing {
  // As the frontend doesn't know all cells, we have to keep track of the highest id
  // and cannot compute it
  const largestSegmentId = tracing.largestSegmentId;
  const userState = getUserStateForTracing(tracing, activeUser, owner);

  const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
    tracing.userBoundingBoxes,
    userState,
  );
  const segmentGroups = applyUserStateToGroups(tracing.segmentGroups || [], userState);
  const segmentVisibilityMap: Record<number, boolean> = userState
    ? mapEntriesToMap(userState.segmentVisibilities)
    : {};

  const volumeTracing = {
    createdTimestamp: tracing.createdTimestamp,
    type: "volume" as const,
    segments: new DiffableMap(
      tracing.segments.map((segment) => {
        const clientSegment: Segment = {
          ...segment,
          id: segment.segmentId,
          anchorPosition: segment.anchorPosition
            ? point3ToVector3(segment.anchorPosition)
            : undefined,
          additionalCoordinates: segment.additionalCoordinates,
          color: segment.color != null ? colorObjectToRGBArray(segment.color) : null,
          isVisible: segmentVisibilityMap[segment.segmentId] ?? segment.isVisible ?? true,
          groupId: segment.groupId ?? null,
        };
        return [segment.segmentId, clientSegment];
      }),
    ),
    segmentGroups,
    activeCellId: userState?.activeSegmentId ?? tracing.activeSegmentId ?? 0,
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
    hideUnregisteredSegments: tracing.hideUnregisteredSegments ?? false,
    proofreadingMarkerPosition: undefined,
    segmentJournal: [],
  };
  return volumeTracing;
}

function getVolumeTracingFromAction(state: WebknossosState, action: VolumeTracingReducerAction) {
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

export function toggleAllSegmentsReducer(
  state: WebknossosState,
  layerName: string,
  isVisible: boolean | undefined,
): WebknossosState {
  const updateInfo = getSegmentUpdateInfo(state, layerName);

  if (updateInfo.type === "NOOP") {
    return state;
  }
  const { segments } = updateInfo;

  const shouldBecomeVisible =
    isVisible ?? Array.from(segments.values()).some((segment) => !segment.isVisible);

  const newSegments = segments.clone();

  Array.from(segments.values()).forEach((segment) => {
    if (segment.isVisible !== shouldBecomeVisible) {
      newSegments.mutableSet(segment.id, { ...segment, isVisible: shouldBecomeVisible });
    }
  });

  return updateSegments(state, layerName, (_oldSegments) => newSegments);
}

function VolumeTracingReducer(
  state: WebknossosState,
  action: VolumeTracingReducerAction,
): WebknossosState {
  switch (action.type) {
    case "INITIALIZE_VOLUMETRACING": {
      const volumeTracing = serverVolumeToClientVolumeTracing(
        action.tracing,
        state.activeUser,
        state.annotation.owner,
      );
      const tracingPredicate = (tracing: VolumeTracing) =>
        tracing.tracingId === volumeTracing.tracingId;
      const newVolumes = replaceOrAdd(state.annotation.volumes, volumeTracing, tracingPredicate);

      let newState = update(state, {
        annotation: {
          volumes: {
            $set: newVolumes,
          },
          readOnly: {
            $set: null,
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
          newState = setActiveCellReducer(
            newState,
            volumeTracing,
            volumeTracing.largestSegmentId,
            null,
          );
        } else {
          newState = createCellReducer(newState, volumeTracing, volumeTracing.largestSegmentId + 1);
        }
      }

      // Extract volumeTracing again because it can have changed by the code from above.
      const newVolumeTracing = newState.annotation.volumes.find(tracingPredicate);
      if (newVolumeTracing == null) {
        // Satisfy TS
        throw new Error("Could not find volume tracing that was just created.");
      }

      return update(newState, {
        save: {
          rebaseRelevantServerAnnotationState: {
            volumes: {
              $set: replaceOrAdd(
                newState.save.rebaseRelevantServerAnnotationState.volumes,
                newVolumeTracing,
                tracingPredicate,
              ),
            },
          },
        },
      });
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

    case "MERGE_SEGMENTS": {
      return handleMergeSegments(state, action);
    }

    case "REMOVE_SEGMENT": {
      return handleRemoveSegment(state, action);
    }

    case "UPDATE_PROOFREADING_MARKER_POSITION": {
      const volumeTracing = getVolumeTracingFromAction(state, action);
      if (volumeTracing) {
        return updateVolumeTracing(state, volumeTracing.tracingId, {
          proofreadingMarkerPosition: action.position,
        });
      }
      return state;
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

    case "TOGGLE_SEGMENT_GROUP": {
      return toggleSegmentGroupReducer(state, action.layerName, action.groupId);
    }

    case "TOGGLE_ALL_SEGMENTS": {
      return toggleAllSegmentsReducer(state, action.layerName, action.isVisible);
    }

    case "SET_SEGMENT_GROUPS": {
      const { segmentGroups } = action;
      return setSegmentGroups(state, action.layerName, segmentGroups);
    }

    case "SET_HIDE_UNREGISTERED_SEGMENTS": {
      const volumeTracing = getVolumeTracingFromAction(state, action);
      if (volumeTracing) {
        return updateVolumeTracing(state, volumeTracing.tracingId, {
          hideUnregisteredSegments: action.value,
        });
      } else {
        const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
        const layerName = action.layerName ?? visibleSegmentationLayer?.name;
        if (layerName == null) {
          return state;
        }

        return update(state, {
          localSegmentationData: {
            [layerName]: {
              hideUnregisteredSegments: {
                $set: action.value,
              },
            },
          },
        });
      }
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

    case "ADD_TO_CONTOUR_LIST": {
      return addToContourListReducer(state, volumeTracing, action.positionInLayerSpace);
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

    case "APPLY_VOLUME_UPDATE_ACTIONS_FROM_SERVER": {
      const { actions, ignoreUnsupportedActionTypes } = action;
      return applyVolumeUpdateActionsFromServer(
        actions,
        state,
        VolumeTracingReducer,
        ignoreUnsupportedActionTypes,
      );
    }

    default:
      return state;
  }
}

export default VolumeTracingReducer;

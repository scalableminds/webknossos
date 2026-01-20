import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import { colorObjectToRGBArray, floor3, mapEntriesToMap, point3ToVector3 } from "libs/utils";
import groupBy from "lodash/groupBy";
import type { APIUserBase, ServerVolumeTracing } from "types/api_types";
import { ContourModeEnum } from "viewer/constants";
import {
  getLayerByName,
  getMappingInfo,
  getMaximumSegmentIdForLayer,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getSegmentName,
  getSegmentationLayerForTracing,
  getSelectedIds,
  getVisibleSegments,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  type ClickSegmentAction,
  type RemoveSegmentAction,
  type SetSegmentsAction,
  type UpdateSegmentAction,
  removeSegmentAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  applyUserStateToGroups,
  convertServerAdditionalAxesToFrontEnd,
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "viewer/model/reducers/reducer_helpers";
import {
  type VolumeTracingReducerAction,
  addToContourListReducer,
  createCellReducer,
  getSegmentUpdateInfo,
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
} from "viewer/model/reducers/volumetracing_reducer_helpers";
import type { EditableMapping, Segment, VolumeTracing, WebknossosState } from "viewer/store";
import {
  findParentIdForGroupId,
  getGroupNodeKey,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { getUserStateForTracing } from "../accessors/annotation_accessor";
import { mapGroups } from "../accessors/skeletontracing_accessor";
import { sanitizeMetadata } from "./skeletontracing_reducer";
import { applyVolumeUpdateActionsFromServer } from "./update_action_application/volume";

function handleSetSegments(state: WebknossosState, action: SetSegmentsAction) {
  const { segments, layerName } = action;
  return updateSegments(state, layerName, (_oldSegments) => segments);
}

function handleRemoveSegment(state: WebknossosState, action: RemoveSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => segments.delete(action.segmentId));
}

type Writable<T> = T extends object ? { -readonly [K in keyof T]: Writable<T[K]> } : T;

function handleUpdateSegment(state: WebknossosState, action: UpdateSegmentAction) {
  return updateSegments(state, action.layerName, (segments) => {
    const { segmentId, segment } = action;
    if (segmentId === 0) {
      return segments;
    }
    const oldSegment = segments.getNullable(segmentId);

    const newSegment: Writable<Segment> = {
      id: segmentId,
      // If oldSegment exists, its creationTime will be
      // used by ...oldSegment
      creationTime: action.timestamp,
      name: null,
      color: null,
      isVisible: true,
      groupId: getSelectedIds(state)[0].group,
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

function expandSegmentParents(state: WebknossosState, action: ClickSegmentAction) {
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
      const newVolumes = state.annotation.volumes.filter(
        (tracing) => tracing.tracingId !== volumeTracing.tracingId,
      );
      newVolumes.push(volumeTracing);
      const newState = update(state, {
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

      return update(newState, {
        save: {
          rebaseRelevantServerAnnotationState: {
            // todop: strictly speaking, we should only add the new volume entry
            volumes: { $set: newState.annotation.volumes },
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
      const updateInfo = getSegmentUpdateInfo(state, action.layerName);
      if (updateInfo.type !== "UPDATE_VOLUME_TRACING") {
        return state;
      }
      const { volumeTracing } = updateInfo;
      const { segments } = volumeTracing;
      const sourceSegment = segments.getNullable(action.sourceId);
      const targetSegment = segments.getNullable(action.targetId);

      let newState = handleRemoveSegment(
        state,
        removeSegmentAction(action.targetId, action.layerName),
      );
      const entryIndex = (volumeTracing.segmentJournal.at(-1)?.entryIndex ?? -1) + 1;

      newState = updateVolumeTracing(newState, volumeTracing.tracingId, {
        segmentJournal: volumeTracing.segmentJournal.concat([
          {
            type: "MERGE_SEGMENTS",
            sourceId: action.sourceId,
            targetId: action.targetId,
            entryIndex,
          },
        ]),
      });

      // Since the target segment is deleted (absorbed by the source segment),
      // we should ensure that no information is lost.
      // However, this is only necessary when the targetSegment is not null.
      if (targetSegment != null) {
        const props: Writable<Partial<Segment>> = {};
        // Handle `name` by concatening names
        if (targetSegment.name != null) {
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
            sourceSegment ?? { id: action.sourceId, name: undefined },
            false,
          );
          props.name = `${sourceName} and ${targetSegment.name}`;
        }

        // Handle metadata by concatening the entries. If the resulting keys
        // would not be unique, the keys are postfixed like this: key-originalSegmentId
        if (targetSegment.metadata.length > 0) {
          const sourceMetadata = sourceSegment?.metadata ?? [];
          const mergedMetadataEntries = sourceMetadata.concat(targetSegment.metadata);
          // Items of mergedMetadataEntries with index < pivotIndex,
          // belong to the source segment. The other belong to the
          // target segment.
          const pivotIndex = sourceMetadata.length;
          const keyToEntries = groupBy(mergedMetadataEntries, (entry) => entry.key);
          const metadataEntriesWithUniqueKeys = mergedMetadataEntries.map((entry, index) => {
            if (keyToEntries[entry.key].length > 1) {
              const originalSegmentId = index < pivotIndex ? action.sourceId : action.targetId;
              return {
                ...entry,
                key: `${entry.key}-${originalSegmentId}`,
              };
            } else {
              return entry;
            }
          });
          props.metadata = metadataEntriesWithUniqueKeys;
        }

        if (Object.keys(props).length > 0) {
          newState = handleUpdateSegment(
            newState,
            updateSegmentAction(action.sourceId, props, action.layerName),
          );
        }
      }

      return newState;

      // todop: adapt journal?
      // can we always append to the segment journal?
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
      const { actions } = action;
      return applyVolumeUpdateActionsFromServer(actions, state, VolumeTracingReducer);
    }

    case "APPEND_TO_SEGMENT_JOURNAL": {
      // todop: delete this because we directly do this in the mergeSegments handling?
      return state;
      // const entryIndex = (volumeTracing.segmentJournal.at(-1)?.entryIndex ?? -1) + 1;

      // return updateVolumeTracing(state, volumeTracing.tracingId, {
      //   segmentJournal: volumeTracing.segmentJournal.concat([{ ...action.entry, entryIndex }]),
      // });
    }

    default:
      return state;
  }
}

export default VolumeTracingReducer;

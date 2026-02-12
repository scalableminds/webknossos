import keyBy from "lodash-es/keyBy";
import type { MetadataEntryProto } from "types/api_types";
import {
  getSegmentsForLayer,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { changeUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import {
  mergeSegmentsAction,
  removeSegmentAction,
  setActiveCellAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type {
  AddUserBoundingBoxInVolumeTracingAction,
  ApplicableVolumeServerUpdateAction,
  DeleteUserBoundingBoxInVolumeTracingAction,
  UpdateUserBoundingBoxInVolumeTracingAction,
} from "viewer/model/sagas/volume/update_actions";
import type { SegmentGroup, WebknossosState } from "viewer/store";
import {
  createGroupHelper,
  findGroup,
  mapGroups,
  moveGroupsHelper,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { updateUserBoundingBox } from "../annotation_reducer";
import {
  setLargestSegmentIdReducer,
  setSegmentGroups,
  toggleSegmentGroupReducer,
  type VolumeTracingReducerAction,
} from "../volumetracing_reducer_helpers";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";
import { withoutServerSpecificFields } from "./shared_update_helper";

export function applyVolumeUpdateActionsFromServer(
  actions: ApplicableVolumeServerUpdateAction[],
  state: WebknossosState,
  VolumeTracingReducer: (
    state: WebknossosState,
    action: VolumeTracingReducerAction,
  ) => WebknossosState,
  ignoreUnsupportedActionTypes: boolean,
): WebknossosState {
  let newState = state;
  for (const ua of actions) {
    newState = applySingleAction(ua, newState, VolumeTracingReducer, ignoreUnsupportedActionTypes);
  }

  return newState;
}

function applySingleAction(
  serverUpdateAction: ApplicableVolumeServerUpdateAction,
  state: WebknossosState,
  VolumeTracingReducer: (
    state: WebknossosState,
    action: VolumeTracingReducerAction,
  ) => WebknossosState,
  ignoreUnsupportedActionTypes: boolean,
): WebknossosState {
  const { actionTracingId, actionTimestamp } = serverUpdateAction.value;
  const ua = withoutServerSpecificFields(serverUpdateAction);
  switch (ua.name) {
    case "updateLargestSegmentId": {
      const volumeTracing = getVolumeTracingById(state.annotation, actionTracingId);
      return setLargestSegmentIdReducer(state, volumeTracing, ua.value.largestSegmentId);
    }
    case "createSegment": {
      const segment = ua.value;
      return VolumeTracingReducer(
        state,
        updateSegmentAction(segment.id, segment, actionTracingId, actionTimestamp, false),
      );
    }
    case "updateSegmentPartial": {
      const segment = ua.value;
      return VolumeTracingReducer(
        state,
        updateSegmentAction(segment.id, segment, actionTracingId, actionTimestamp, false),
      );
    }
    case "updateMetadataOfSegment": {
      const { id, upsertEntriesByKey, removeEntriesByKey } = ua.value;
      const segments = getSegmentsForLayer(state, actionTracingId);
      const segment = segments.getNullable(id);
      if (segment == null) {
        throw new Error(`Cannot find segment with id ${id} during application of update action.`);
      }
      const { metadata } = segment;

      const removeKeySet = new Set(removeEntriesByKey);
      const upsertDict = keyBy(upsertEntriesByKey, "key");

      const metadataEntries = metadata.map(
        (item) => [item.key, item] as [string, MetadataEntryProto],
      );

      const newMetadata = metadataEntries
        // Only keep the items that should not be removed or changed
        .filter(([key]) => !removeKeySet.has(key) && upsertDict[key] == null)
        .map(([_key, item]) => item)
        .concat(upsertEntriesByKey);

      return VolumeTracingReducer(
        state,
        updateSegmentAction(id, { metadata: newMetadata }, actionTracingId, actionTimestamp, false),
      );
    }
    case "mergeSegments": {
      return VolumeTracingReducer(
        state,
        mergeSegmentsAction(ua.value.sourceId, ua.value.targetId, actionTracingId),
      );
    }
    case "deleteSegment": {
      return VolumeTracingReducer(state, removeSegmentAction(ua.value.id, actionTracingId));
    }
    case "upsertSegmentGroup": {
      const { groupId, newParentId, name, ...props } = ua.value;
      const maybeNewName = name != null ? { name } : {};
      const volumeTracing = getVolumeTracingById(state.annotation, actionTracingId);
      const oldSegmentGroups = volumeTracing.segmentGroups;

      const existingGroup = findGroup(oldSegmentGroups, groupId);
      let newSegmentGroups;
      if (existingGroup) {
        newSegmentGroups = mapGroups(oldSegmentGroups, (group) =>
          group.groupId === ua.value.groupId
            ? {
                ...group,
                ...props,
                ...maybeNewName,
              }
            : group,
        );

        if ("newParentId" in ua.value) {
          newSegmentGroups = moveGroupsHelper(newSegmentGroups, groupId, ua.value.newParentId);
        }
      } else {
        newSegmentGroups = createGroupHelper(
          oldSegmentGroups,
          ua.value.name ?? null,
          groupId,
          newParentId ?? null,
        ).newSegmentGroups;
      }

      return VolumeTracingReducer(state, setSegmentGroupsAction(newSegmentGroups, actionTracingId));
    }
    case "deleteSegmentGroup": {
      const volumeTracing = getVolumeTracingById(state.annotation, actionTracingId);
      const oldSegmentGroups = volumeTracing.segmentGroups;

      // todop: use sth similar to how moveGroupsHelper does it?
      function deepFilter<T extends SegmentGroup>(
        nodes: T[],
        predicate: (node: T) => boolean,
      ): T[] {
        // Apply a deep "filter" function to a Tree/Group hierarchy structure, traversing along their children.
        return nodes.reduce((acc: T[], node: T) => {
          if (predicate(node)) {
            acc.push({
              ...node,
              children: deepFilter(node.children as T[], predicate),
            });
          }
          return acc;
        }, []);
      }

      const newSegmentGroups = deepFilter(
        oldSegmentGroups,
        (group) => group.groupId !== ua.value.groupId,
      );

      return VolumeTracingReducer(state, setSegmentGroupsAction(newSegmentGroups, actionTracingId));
    }
    case "updateUserBoundingBoxInVolumeTracing": {
      return applyUpdateUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, actionTracingId),
        ua as UpdateUserBoundingBoxInVolumeTracingAction,
      );
    }
    case "addUserBoundingBoxInVolumeTracing": {
      return applyAddUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, actionTracingId),
        ua as AddUserBoundingBoxInVolumeTracingAction,
      );
    }
    case "deleteUserBoundingBoxInVolumeTracing": {
      return applyDeleteUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, actionTracingId),
        ua as DeleteUserBoundingBoxInVolumeTracingAction,
      );
    }

    // These update actions below are user specific and only need to be applied
    // if these actions originate from the current user (this happens when rebasing such actions).
    case "updateSegmentGroupsExpandedState": {
      const { areExpanded, groupIds } = ua.value;
      const { segmentGroups } = getVolumeTracingById(state.annotation, actionTracingId);
      const currentlyExpandedSegmentGroupIds = new Set(
        Object.values(segmentGroups)
          .filter((g) => g.isExpanded)
          .map((g) => g.groupId),
      );
      const groupIdSet = new Set(groupIds);
      const newExpandedGroupIds = areExpanded
        ? currentlyExpandedSegmentGroupIds.union(groupIdSet)
        : currentlyExpandedSegmentGroupIds.difference(groupIdSet);
      const newGroups = mapGroups(segmentGroups, (group) => {
        const shouldBeExpanded = newExpandedGroupIds.has(group.groupId);
        if (shouldBeExpanded !== group.isExpanded) {
          return {
            ...group,
            isExpanded: shouldBeExpanded,
          };
        } else {
          return group;
        }
      });
      return setSegmentGroups(state, actionTracingId, newGroups);
    }
    case "updateUserBoundingBoxVisibilityInVolumeTracing": {
      return updateUserBoundingBox(
        state,
        changeUserBoundingBoxAction(ua.value.boundingBoxId, {
          isVisible: ua.value.isVisible,
        }),
      );
    }
    case "updateSegmentVisibility": {
      return VolumeTracingReducer(
        state,
        updateSegmentAction(
          ua.value.id,
          { isVisible: ua.value.isVisible },
          actionTracingId,
          actionTimestamp,
          false,
        ),
      );
    }
    case "updateActiveSegmentId": {
      return VolumeTracingReducer(state, setActiveCellAction(ua.value.activeSegmentId));
    }
    case "updateSegmentGroupVisibility": {
      const { groupId, isVisible } = ua.value;
      if (groupId != null) {
        return toggleSegmentGroupReducer(state, actionTracingId, groupId, isVisible);
      }
      return state;
    }
    default: {
      ua satisfies never;
    }
  }

  ua satisfies never;

  if (ignoreUnsupportedActionTypes) {
    return state;
  }
  // Satisfy TS.
  throw new Error("Reached unexpected part of function.");
}

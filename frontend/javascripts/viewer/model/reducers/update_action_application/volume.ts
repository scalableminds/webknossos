import _ from "lodash";
import type { MetadataEntryProto } from "types/api_types";
import { mapGroups } from "viewer/model/accessors/skeletontracing_accessor";
import {
  getSegmentsForLayer,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { changeUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import {
  removeSegmentAction,
  setActiveCellAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { ApplicableVolumeUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { WebknossosState } from "viewer/store";
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

export function applyVolumeUpdateActionsFromServer(
  actions: ApplicableVolumeUpdateAction[],
  state: WebknossosState,
  VolumeTracingReducer: (
    state: WebknossosState,
    action: VolumeTracingReducerAction,
  ) => WebknossosState,
): WebknossosState {
  let newState = state;
  for (const ua of actions) {
    newState = applySingleAction(ua, newState, VolumeTracingReducer);
  }

  return newState;
}

function applySingleAction(
  ua: ApplicableVolumeUpdateAction,
  state: WebknossosState,
  VolumeTracingReducer: (
    state: WebknossosState,
    action: VolumeTracingReducerAction,
  ) => WebknossosState,
): WebknossosState {
  switch (ua.name) {
    case "updateLargestSegmentId": {
      const volumeTracing = getVolumeTracingById(state.annotation, ua.value.actionTracingId);
      return setLargestSegmentIdReducer(state, volumeTracing, ua.value.largestSegmentId);
    }
    case "createSegment": {
      const { actionTracingId, ...segment } = ua.value;
      return VolumeTracingReducer(state, updateSegmentAction(segment.id, segment, actionTracingId));
    }
    case "updateSegmentPartial": {
      const { actionTracingId, ...segment } = ua.value;
      return VolumeTracingReducer(
        state,
        updateSegmentAction(segment.id, segment, actionTracingId, Date.now(), false),
      );
    }
    case "updateMetadataOfSegment": {
      const { actionTracingId, id, upsertEntriesByKey, removeEntriesByKey } = ua.value;
      const segments = getSegmentsForLayer(state, actionTracingId);
      const segment = segments.getNullable(id);
      if (segment == null) {
        throw new Error(`Cannot find segment with id ${id} during application of update action.`);
      }
      const { metadata } = segment;

      const removeKeySet = new Set(removeEntriesByKey);
      const upsertDict = _.keyBy(upsertEntriesByKey, "key");

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
        updateSegmentAction(id, { metadata: newMetadata }, actionTracingId, Date.now(), false),
      );
    }
    case "deleteSegment": {
      return VolumeTracingReducer(
        state,
        removeSegmentAction(ua.value.id, ua.value.actionTracingId),
      );
    }
    case "updateSegmentGroups": {
      return VolumeTracingReducer(
        state,
        setSegmentGroupsAction(ua.value.segmentGroups, ua.value.actionTracingId),
      );
    }
    case "updateUserBoundingBoxInVolumeTracing": {
      return applyUpdateUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, ua.value.actionTracingId),
        ua,
      );
    }
    case "addUserBoundingBoxInVolumeTracing": {
      return applyAddUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, ua.value.actionTracingId),
        ua,
      );
    }
    case "deleteUserBoundingBoxInVolumeTracing": {
      return applyDeleteUserBoundingBox(
        state,
        getVolumeTracingById(state.annotation, ua.value.actionTracingId),
        ua,
      );
    }

    // These update actions below are user specific and only need to be applied
    // if these actions originate from the current user (this happens when rebasing such actions).
    case "updateSegmentGroupsExpandedState": {
      const { areExpanded, groupIds, actionTracingId } = ua.value;
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
          ua.value.actionTracingId,
        ),
      );
    }
    case "updateActiveSegmentId": {
      return VolumeTracingReducer(state, setActiveCellAction(ua.value.activeSegmentId));
    }
    case "updateSegmentGroupVisibility": {
      const { groupId, actionTracingId, isVisible } = ua.value;
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

  // Satisfy TS.
  throw new Error("Reached unexpected part of function.");
}

import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import {
  removeSegmentAction,
  setActiveCellAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { ApplicableVolumeUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { Segment, WebknossosState } from "viewer/store";
import {
  setSegmentGroups,
  toggleSegmentGroupReducer,
  type VolumeTracingReducerAction,
} from "../volumetracing_reducer";
import { setLargestSegmentIdReducer } from "../volumetracing_reducer_helpers";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";
import { mapGroups } from "viewer/model/accessors/skeletontracing_accessor";
import { updateUserBoundingBox } from "../annotation_reducer";
import { changeUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";

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
    case "createSegment":
    case "updateSegment": {
      const { actionTracingId, ...originalSegment } = ua.value;
      const { anchorPosition, ...segmentWithoutAnchor } = originalSegment;
      const segment: Partial<Segment> = {
        somePosition: anchorPosition ?? undefined,
        ...segmentWithoutAnchor,
      };
      return VolumeTracingReducer(
        state,
        updateSegmentAction(originalSegment.id, segment, actionTracingId),
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
    case "updateSegmentGroupsExpandedState": {
      const { areExpanded, groupIds, actionTracingId } = ua.value;
      const { segmentGroups } = getVolumeTracingById(state.annotation, actionTracingId);
      const currentlyExpandedSegmentGroupIds = new Set(
        Object.values(segmentGroups)
          .filter((g) => g.isExpanded)
          .map((g) => g.groupId),
      );
      const actionGroupIds = new Set(groupIds);
      const newExpandedGroupIds = areExpanded
        ? currentlyExpandedSegmentGroupIds.union(actionGroupIds)
        : currentlyExpandedSegmentGroupIds.difference(actionGroupIds);
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

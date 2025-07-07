import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import {
  removeSegmentAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { ApplicableVolumeUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { Segment, WebknossosState } from "viewer/store";
import type { VolumeTracingReducerAction } from "../volumetracing_reducer";
import { setLargestSegmentIdReducer } from "../volumetracing_reducer_helpers";
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
    case "updateSegmentGroupsExpandedState":
    case "updateUserBoundingBoxVisibilityInVolumeTracing": {
      // These update actions are user specific and don't need to be incorporated here
      // because they are from another user.
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

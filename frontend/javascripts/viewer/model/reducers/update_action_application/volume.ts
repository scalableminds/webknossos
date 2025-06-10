import { getVolumeTracingById } from "viewer/model/accessors/volumetracing_accessor";
import {
  removeSegmentAction,
  setSegmentGroupsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { ApplicableVolumeUpdateAction } from "viewer/model/sagas/update_actions";
import type { WebknossosState } from "viewer/store";
import type { VolumeTracingReducerAction } from "../volumetracing_reducer";
import { setLargestSegmentIdReducer } from "../volumetracing_reducer_helpers";
import {
  applyAddUserBoundingBox,
  applyDeleteUserBoundingBox,
  applyUpdateUserBoundingBox,
} from "./bounding_box";
import type { TreeGroup } from "viewer/model/types/tree_types";

export function applyVolumeUpdateActionsFromServer(
  actions: ApplicableVolumeUpdateAction[],
  newState: WebknossosState,
  VolumeTracingReducer: (
    state: WebknossosState,
    action: VolumeTracingReducerAction,
  ) => WebknossosState,
): { value: WebknossosState } {
  for (const ua of actions) {
    switch (ua.name) {
      case "updateLargestSegmentId": {
        const volumeTracing = getVolumeTracingById(newState.annotation, ua.value.actionTracingId);
        newState = setLargestSegmentIdReducer(
          newState,
          volumeTracing,
          // todop: can this really be null? if so, what should we do?
          ua.value.largestSegmentId ?? 0,
        );
        break;
      }
      case "createSegment":
      case "updateSegment": {
        const { actionTracingId, ...segment } = ua.value;
        newState = VolumeTracingReducer(
          newState,
          updateSegmentAction(segment.id, segment, actionTracingId),
        );
        break;
      }
      case "deleteSegment": {
        newState = VolumeTracingReducer(
          newState,
          removeSegmentAction(ua.value.id, ua.value.actionTracingId),
        );
        break;
      }
      case "updateSegmentGroups": {
        newState = VolumeTracingReducer(
          newState,
          setSegmentGroupsAction(ua.value.segmentGroups, ua.value.actionTracingId),
        );
        break;
      }
      case "updateUserBoundingBoxInVolumeTracing": {
        newState = applyUpdateUserBoundingBox(
          newState,
          getVolumeTracingById(newState.annotation, ua.value.actionTracingId),
          ua,
        );
        break;
      }
      case "addUserBoundingBoxInVolumeTracing": {
        newState = applyAddUserBoundingBox(
          newState,
          getVolumeTracingById(newState.annotation, ua.value.actionTracingId),
          ua,
        );
        break;
      }
      case "deleteUserBoundingBoxInVolumeTracing": {
        newState = applyDeleteUserBoundingBox(
          newState,
          getVolumeTracingById(newState.annotation, ua.value.actionTracingId),
          ua,
        );
        break;
      }
      default: {
        ua satisfies never;
      }
    }
  }

  // The state is wrapped in this container object to prevent the above switch-cases from
  // accidentally returning newState (which is common in reducers but would ignore
  // remaining update actions here).
  return { value: newState };
}

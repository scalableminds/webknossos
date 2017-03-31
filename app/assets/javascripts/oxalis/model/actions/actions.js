/* eslint-disable import/prefer-default-export */

// @flow
import type { SkeletonTracingActionTypes } from "oxalis/model/actions/skeletontracing_actions";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { TaskActionTypes } from "oxalis/model/actions/task_actions";
import type { SaveActionTypes } from "oxalis/model/actions/save_actions";

export type ActionType =
  SkeletonTracingActionTypes |
  VolumeTracingActionType |
  SettingActionType |
  TaskActionTypes |
  SaveActionTypes;

export const wkReadyAction = () => ({
  type: "WK_READY",
});

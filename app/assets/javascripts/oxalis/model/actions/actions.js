/* eslint-disable import/prefer-default-export */

// @flow
import type { SkeletonTracingActionType } from "oxalis/model/actions/skeletontracing_actions";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { TaskActionType } from "oxalis/model/actions/task_actions";
import type { SaveActionType } from "oxalis/model/actions/save_actions";

export type ActionType =
  SkeletonTracingActionType |
  VolumeTracingActionType |
  SettingActionType |
  TaskActionType |
  SaveActionType;

export const wkReadyAction = () => ({
  type: "WK_READY",
});

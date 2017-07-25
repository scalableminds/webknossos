/* eslint-disable import/prefer-default-export */

// @flow
import type { SkeletonTracingActionType } from "oxalis/model/actions/skeletontracing_actions";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { ReadOnlyTracingActionType } from "oxalis/model/actions/readonlytracing_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { TaskActionType } from "oxalis/model/actions/task_actions";
import type { SaveActionType } from "oxalis/model/actions/save_actions";
import type { ViewModeActionType } from "oxalis/model/actions/view_mode_actions";

export type ActionType =
  SkeletonTracingActionType |
  VolumeTracingActionType |
  ReadOnlyTracingActionType |
  SettingActionType |
  TaskActionType |
  SaveActionType |
  ViewModeActionType;

export const wkReadyAction = () => ({
  type: "WK_READY",
});

export const restartSagaAction = () => ({
  type: "RESTART_SAGA",
});

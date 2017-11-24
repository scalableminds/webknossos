/* eslint-disable import/prefer-default-export */

// @flow
import type { SkeletonTracingActionType } from "oxalis/model/actions/skeletontracing_actions";
import type { VolumeTracingActionType } from "oxalis/model/actions/volumetracing_actions";
import type { SettingActionType } from "oxalis/model/actions/settings_actions";
import type { TaskActionType } from "oxalis/model/actions/task_actions";
import type { SaveActionType } from "oxalis/model/actions/save_actions";
import type { ViewModeActionType } from "oxalis/model/actions/view_mode_actions";
import type { AnnotationActionTypes } from "oxalis/model/actions/annotation_actions";
import type { FlycamActionType } from "oxalis/model/actions/flycam_actions";
import type { UserActionType } from "oxalis/model/actions/user_actions";

export type ActionType =
  | SkeletonTracingActionType
  | VolumeTracingActionType
  | SettingActionType
  | TaskActionType
  | SaveActionType
  | ViewModeActionType
  | AnnotationActionTypes
  | FlycamActionType
  | UserActionType;

export const wkReadyAction = () => ({
  type: "WK_READY",
});

export const restartSagaAction = () => ({
  type: "RESTART_SAGA",
});

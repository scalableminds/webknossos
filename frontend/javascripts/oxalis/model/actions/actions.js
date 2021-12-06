// @flow
import type { AnnotationActionTypes } from "oxalis/model/actions/annotation_actions";
import type { DatasetAction } from "oxalis/model/actions/dataset_actions";
import type { FlycamAction } from "oxalis/model/actions/flycam_actions";
import type { IsosurfaceAction } from "oxalis/model/actions/segmentation_actions";
import type { SaveAction } from "oxalis/model/actions/save_actions";
import type { SettingAction } from "oxalis/model/actions/settings_actions";
import type { SkeletonTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import type { TaskAction } from "oxalis/model/actions/task_actions";
import type { UiAction } from "oxalis/model/actions/ui_actions";
import type { UserAction } from "oxalis/model/actions/user_actions";
import type { ViewModeAction } from "oxalis/model/actions/view_mode_actions";
import type { VolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";
import type { ConnectomeAction } from "oxalis/model/actions/connectome_actions";

export type Action =
  | SkeletonTracingAction
  | VolumeTracingAction
  | SettingAction
  | DatasetAction
  | TaskAction
  | SaveAction
  | ViewModeAction
  | AnnotationActionTypes
  | FlycamAction
  | UserAction
  | UiAction
  | IsosurfaceAction
  | ConnectomeAction;

export const wkReadyAction = () => ({
  type: "WK_READY",
});

export const sceneControllerReadyAction = () => ({
  type: "SCENE_CONTROLLER_READY",
});

export const restartSagaAction = () => ({
  type: "RESTART_SAGA",
});

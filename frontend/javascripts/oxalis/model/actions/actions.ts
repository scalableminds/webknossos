import type { AnnotationActionTypes } from "oxalis/model/actions/annotation_actions";
import type { ConnectomeAction } from "oxalis/model/actions/connectome_actions";
import type { DatasetAction } from "oxalis/model/actions/dataset_actions";
import type { FlycamAction } from "oxalis/model/actions/flycam_actions";
import type { OrganizationAction } from "oxalis/model/actions/organization_actions";
import type { ProofreadAction } from "oxalis/model/actions/proofread_actions";
import type { SaveAction } from "oxalis/model/actions/save_actions";
import type { SegmentationAction } from "oxalis/model/actions/segmentation_actions";
import type { SettingAction } from "oxalis/model/actions/settings_actions";
import type { SkeletonTracingAction } from "oxalis/model/actions/skeletontracing_actions";
import type { TaskAction } from "oxalis/model/actions/task_actions";
import type { UiAction } from "oxalis/model/actions/ui_actions";
import type { UserAction } from "oxalis/model/actions/user_actions";
import type { ViewModeAction } from "oxalis/model/actions/view_mode_actions";
import type { VolumeTracingAction } from "oxalis/model/actions/volumetracing_actions";

export type EscalateErrorAction = ReturnType<typeof escalateErrorAction>;

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
  | SegmentationAction
  | ConnectomeAction
  | ProofreadAction
  | OrganizationAction
  | ReturnType<typeof wkReadyAction>
  | ReturnType<typeof sceneControllerReadyAction>
  | ReturnType<typeof restartSagaAction>
  | ReturnType<typeof cancelSagaAction>
  | EscalateErrorAction;

export const wkReadyAction = () =>
  ({
    type: "WK_READY",
  }) as const;

export const sceneControllerReadyAction = () =>
  ({
    type: "SCENE_CONTROLLER_READY",
  }) as const;

export const restartSagaAction = () =>
  ({
    type: "RESTART_SAGA",
  }) as const;

export const cancelSagaAction = () =>
  ({
    type: "CANCEL_SAGA",
  }) as const;

export const escalateErrorAction = (error: unknown) =>
  ({
    type: "ESCALATE_ERROR",
    error,
  }) as const;

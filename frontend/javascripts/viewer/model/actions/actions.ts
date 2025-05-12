import type { AnnotationActionTypes } from "viewer/model/actions/annotation_actions";
import type { ConnectomeAction } from "viewer/model/actions/connectome_actions";
import type { DatasetAction } from "viewer/model/actions/dataset_actions";
import type { FlycamAction } from "viewer/model/actions/flycam_actions";
import type { FlycamInfoCacheAction } from "viewer/model/actions/flycam_info_cache_actions";
import type { OrganizationAction } from "viewer/model/actions/organization_actions";
import type { ProofreadAction } from "viewer/model/actions/proofread_actions";
import type { SaveAction } from "viewer/model/actions/save_actions";
import type { SegmentationAction } from "viewer/model/actions/segmentation_actions";
import type { SettingAction } from "viewer/model/actions/settings_actions";
import type { SkeletonTracingAction } from "viewer/model/actions/skeletontracing_actions";
import type { TaskAction } from "viewer/model/actions/task_actions";
import type { UiAction } from "viewer/model/actions/ui_actions";
import type { UserAction } from "viewer/model/actions/user_actions";
import type { ViewModeAction } from "viewer/model/actions/view_mode_actions";
import type { VolumeTracingAction } from "viewer/model/actions/volumetracing_actions";

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
  | FlycamInfoCacheAction
  | UserAction
  | UiAction
  | SegmentationAction
  | ConnectomeAction
  | ProofreadAction
  | OrganizationAction
  | ReturnType<typeof wkReadyAction>
  | ReturnType<typeof sceneControllerReadyAction>
  | ReturnType<typeof restartSagaAction>
  | ReturnType<typeof resetStoreAction>
  | ReturnType<typeof cancelSagaAction>
  | EscalateErrorAction;

export const wkReadyAction = () =>
  ({
    type: "WK_READY",
  }) as const;

export const resetStoreAction = () =>
  ({
    type: "RESET_STORE",
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

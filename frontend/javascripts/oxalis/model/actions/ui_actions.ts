import type { AnnotationTool, Vector3 } from "oxalis/constants";
import type { OxalisState, BorderOpenStatus, Theme } from "oxalis/store";
import type { StartAIJobModalState } from "oxalis/view/action-bar/starting_job_modals";

type SetDropzoneModalVisibilityAction = ReturnType<typeof setDropzoneModalVisibilityAction>;
type SetVersionRestoreVisibilityAction = ReturnType<typeof setVersionRestoreVisibilityAction>;
type SetStoredLayoutsAction = ReturnType<typeof setStoredLayoutsAction>;
type SetBorderOpenStatusAction = ReturnType<typeof setBorderOpenStatusAction>;
type SetImportingMeshStateAction = ReturnType<typeof setImportingMeshStateAction>;
type SetIsInAnnotationViewAction = ReturnType<typeof setIsInAnnotationViewAction>;
type SetHasOrganizationsAction = ReturnType<typeof setHasOrganizationsAction>;
export type SetToolAction = ReturnType<typeof setToolAction>;
export type CycleToolAction = ReturnType<typeof cycleToolAction>;
type SetThemeAction = ReturnType<typeof setThemeAction>;
type SetDownloadModalVisibilityAction = ReturnType<typeof setDownloadModalVisibilityAction>;
type SetShareModalVisibilityAction = ReturnType<typeof setShareModalVisibilityAction>;
type SetBusyBlockingInfoAction = ReturnType<typeof setBusyBlockingInfoAction>;
type SetPythonClientModalVisibilityAction = ReturnType<typeof setPythonClientModalVisibilityAction>;
type SetAIJobModalStateAction = ReturnType<typeof setAIJobModalStateAction>;
export type EnterAction = ReturnType<typeof enterAction>;
export type EscapeAction = ReturnType<typeof escapeAction>;
export type SetQuickSelectStateAction = ReturnType<typeof setQuickSelectStateAction>;
type ShowQuickSelectSettingsAction = ReturnType<typeof showQuickSelectSettingsAction>;
type HideMeasurementTooltipAction = ReturnType<typeof hideMeasurementTooltipAction>;
type SetLastMeasuredPositionAction = ReturnType<typeof setLastMeasuredPositionAction>;
type SetIsMeasuringAction = ReturnType<typeof setIsMeasuringAction>;
type SetNavbarHeightAction = ReturnType<typeof setNavbarHeightAction>;
type SetSkeletonSAMProgressPercentageAction = ReturnType<
  typeof setSkeletonSAMProgressPercentageAction
>;
type HideSkeletonSAMModalAction = ReturnType<typeof hideSkeletonSAMModalAction>;
type SetRenderAnimationModalVisibilityAction = ReturnType<
  typeof setRenderAnimationModalVisibilityAction
>;

export type UiAction =
  | SetDropzoneModalVisibilityAction
  | SetVersionRestoreVisibilityAction
  | SetImportingMeshStateAction
  | SetBorderOpenStatusAction
  | SetStoredLayoutsAction
  | SetIsInAnnotationViewAction
  | SetHasOrganizationsAction
  | SetToolAction
  | CycleToolAction
  | SetThemeAction
  | SetDownloadModalVisibilityAction
  | SetPythonClientModalVisibilityAction
  | SetShareModalVisibilityAction
  | SetAIJobModalStateAction
  | SetRenderAnimationModalVisibilityAction
  | SetBusyBlockingInfoAction
  | EnterAction
  | EscapeAction
  | SetQuickSelectStateAction
  | ShowQuickSelectSettingsAction
  | HideMeasurementTooltipAction
  | SetLastMeasuredPositionAction
  | SetIsMeasuringAction
  | SetNavbarHeightAction
  | SetSkeletonSAMProgressPercentageAction
  | HideSkeletonSAMModalAction;

export const setDropzoneModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_DROPZONE_MODAL_VISIBILITY",
    visible,
  }) as const;
export const setVersionRestoreVisibilityAction = (active: boolean) =>
  ({
    type: "SET_VERSION_RESTORE_VISIBILITY",
    active,
  }) as const;
export const setStoredLayoutsAction = (storedLayouts: Record<string, any>) =>
  ({
    type: "SET_STORED_LAYOUTS",
    storedLayouts,
  }) as const;
export const setBorderOpenStatusAction = (borderOpenStatus: BorderOpenStatus) =>
  ({
    type: "SET_BORDER_OPEN_STATUS",
    borderOpenStatus,
  }) as const;
export const setImportingMeshStateAction = (isImporting: boolean) =>
  ({
    type: "SET_IMPORTING_MESH_STATE",
    isImporting,
  }) as const;
export const setIsInAnnotationViewAction = (value: boolean) =>
  ({
    type: "SET_IS_IN_ANNOTATION_VIEW",
    value,
  }) as const;
export const setHasOrganizationsAction = (value: boolean) =>
  ({
    type: "SET_HAS_ORGANIZATIONS",
    value,
  }) as const;
export const setToolAction = (tool: AnnotationTool) =>
  ({
    type: "SET_TOOL",
    tool,
  }) as const;
export const cycleToolAction = (backwards: boolean = false) =>
  ({
    type: "CYCLE_TOOL",
    backwards,
  }) as const;
export const setThemeAction = (value: Theme) =>
  ({
    type: "SET_THEME",
    value,
  }) as const;
export const setDownloadModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_DOWNLOAD_MODAL_VISIBILITY",
    visible,
  }) as const;
export const setShareModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_SHARE_MODAL_VISIBILITY",
    visible,
  }) as const;
export const setAIJobModalStateAction = (state: StartAIJobModalState) =>
  ({
    type: "SET_AI_JOB_MODAL_STATE",
    state,
  }) as const;
export const setRenderAnimationModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_CREATE_ANIMATION_MODAL_VISIBILITY",
    visible,
  }) as const;
export const setBusyBlockingInfoAction = (isBusy: boolean, reason?: string) =>
  ({
    type: "SET_BUSY_BLOCKING_INFO_ACTION",
    value: {
      isBusy,
      reason,
    },
  }) as const;
export const setPythonClientModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_PYTHON_MODAL_VISIBILITY",
    visible,
  }) as const;
export const enterAction = () =>
  ({
    type: "ENTER",
  }) as const;
export const escapeAction = () =>
  ({
    type: "ESCAPE",
  }) as const;
export const setQuickSelectStateAction = (
  state: OxalisState["uiInformation"]["quickSelectState"],
) =>
  ({
    type: "SET_QUICK_SELECT_STATE",
    state,
  }) as const;
export const showQuickSelectSettingsAction = (isOpen: boolean) =>
  ({
    type: "SET_ARE_QUICK_SELECT_SETTINGS_OPEN",
    isOpen,
  }) as const;
export const hideMeasurementTooltipAction = () =>
  ({
    type: "HIDE_MEASUREMENT_TOOLTIP",
  }) as const;
export const setLastMeasuredPositionAction = (position: Vector3) =>
  ({
    type: "SET_LAST_MEASURED_POSITION",
    position,
  }) as const;
export const setIsMeasuringAction = (isMeasuring: boolean) =>
  ({
    type: "SET_IS_MEASURING",
    isMeasuring,
  }) as const;
export const setNavbarHeightAction = (navbarHeight: number) =>
  ({
    type: "SET_NAVBAR_HEIGHT",
    navbarHeight,
  }) as const;
export const setSkeletonSAMProgressPercentageAction = (
  skeletonSAMProgressPercentage: number | null,
) =>
  ({
    type: "SET_SKELETON_SAM_PROGRESS_PERCENTAGE",
    skeletonSAMProgressPercentage,
  }) as const;
export const hideSkeletonSAMModalAction = () =>
  ({
    type: "HIDE_SKELETON_SAM_MODAL",
  }) as const;

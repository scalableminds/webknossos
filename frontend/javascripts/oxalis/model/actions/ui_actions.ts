import type { AnnotationTool } from "oxalis/constants";
import type { BorderOpenStatus, Theme } from "oxalis/store";

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
  | SetBusyBlockingInfoAction;

export const setDropzoneModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_DROPZONE_MODAL_VISIBILITY",
    visible,
  } as const);
export const setVersionRestoreVisibilityAction = (active: boolean) =>
  ({
    type: "SET_VERSION_RESTORE_VISIBILITY",
    active,
  } as const);
export const setStoredLayoutsAction = (storedLayouts: Record<string, any>) =>
  ({
    type: "SET_STORED_LAYOUTS",
    storedLayouts,
  } as const);
export const setBorderOpenStatusAction = (borderOpenStatus: BorderOpenStatus) =>
  ({
    type: "SET_BORDER_OPEN_STATUS",
    borderOpenStatus,
  } as const);
export const setImportingMeshStateAction = (isImporting: boolean) =>
  ({
    type: "SET_IMPORTING_MESH_STATE",
    isImporting,
  } as const);
export const setIsInAnnotationViewAction = (value: boolean) =>
  ({
    type: "SET_IS_IN_ANNOTATION_VIEW",
    value,
  } as const);
export const setHasOrganizationsAction = (value: boolean) =>
  ({
    type: "SET_HAS_ORGANIZATIONS",
    value,
  } as const);
export const setToolAction = (tool: AnnotationTool) =>
  ({
    type: "SET_TOOL",
    tool,
  } as const);
export const cycleToolAction = () =>
  ({
    type: "CYCLE_TOOL",
  } as const);
export const setThemeAction = (value: Theme) =>
  ({
    type: "SET_THEME",
    value,
  } as const);
export const setDownloadModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_DOWNLOAD_MODAL_VISIBILITY",
    visible,
  } as const);
export const setShareModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_SHARE_MODAL_VISIBILITY",
    visible,
  } as const);
export const setBusyBlockingInfoAction = (isBusy: boolean, reason?: string) =>
  ({
    type: "SET_BUSY_BLOCKING_INFO_ACTION",
    value: {
      isBusy,
      reason,
    },
  } as const);
export const setPythonClientModalVisibilityAction = (visible: boolean) =>
  ({
    type: "SET_PYTHON_MODAL_VISIBILITY",
    visible,
  } as const);

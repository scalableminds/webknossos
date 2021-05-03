// @flow

import { type BorderOpenStatus, type Theme } from "oxalis/store";

type SetDropzoneModalVisibilityAction = {
  type: "SET_DROPZONE_MODAL_VISIBILITY",
  visible: boolean,
};

type SetVersionRestoreVisibilityAction = {
  type: "SET_VERSION_RESTORE_VISIBILITY",
  active: boolean,
};

type SetStoredLayoutsAction = {
  type: "SET_STORED_LAYOUTS",
  storedLayouts: Object,
};

type SetBorderOpenStatusAction = {
  type: "SET_BORDER_OPEN_STATUS",
  borderOpenStatus: BorderOpenStatus,
};

type SetImportingMeshStateAction = {
  type: "SET_IMPORTING_MESH_STATE",
  isImporting: boolean,
};

type SetIsInAnnotationViewAction = {
  type: "SET_IS_IN_ANNOTATION_VIEW",
  value: boolean,
};

type SetHasOrganizationsAction = {
  type: "SET_HAS_ORGANIZATIONS",
  value: boolean,
};

type SetThemeAction = {
  type: "SET_THEME",
  value: Theme,
};

export type UiAction =
  | SetDropzoneModalVisibilityAction
  | SetVersionRestoreVisibilityAction
  | SetImportingMeshStateAction
  | SetBorderOpenStatusAction
  | SetStoredLayoutsAction
  | SetIsInAnnotationViewAction
  | SetHasOrganizationsAction
  | SetThemeAction;

export const setDropzoneModalVisibilityAction = (
  visible: boolean,
): SetDropzoneModalVisibilityAction => ({
  type: "SET_DROPZONE_MODAL_VISIBILITY",
  visible,
});

export const setVersionRestoreVisibilityAction = (
  active: boolean,
): SetVersionRestoreVisibilityAction => ({
  type: "SET_VERSION_RESTORE_VISIBILITY",
  active,
});

export const setStoredLayoutsAction = (storedLayouts: Object): SetStoredLayoutsAction => ({
  type: "SET_STORED_LAYOUTS",
  storedLayouts,
});

export const setBorderOpenStatusAction = (
  borderOpenStatus: BorderOpenStatus,
): SetBorderOpenStatusAction => ({
  type: "SET_BORDER_OPEN_STATUS",
  borderOpenStatus,
});

export const setImportingMeshStateAction = (isImporting: boolean): SetImportingMeshStateAction => ({
  type: "SET_IMPORTING_MESH_STATE",
  isImporting,
});

export const setIsInAnnotationViewAction = (value: boolean): SetIsInAnnotationViewAction => ({
  type: "SET_IS_IN_ANNOTATION_VIEW",
  value,
});

export const setHasOrganizationsAction = (value: boolean): SetHasOrganizationsAction => ({
  type: "SET_HAS_ORGANIZATIONS",
  value,
});

export const setThemeAction = (value: Theme): SetThemeAction => ({
  type: "SET_THEME",
  value,
});

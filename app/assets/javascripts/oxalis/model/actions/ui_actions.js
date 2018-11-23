// @flow
/* eslint-disable import/prefer-default-export */

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

type SetImportingMeshStateAction = {
  type: "SET_IMPORTING_MESH_STATE",
  isImporting: boolean,
};

export type UiAction =
  | SetDropzoneModalVisibilityAction
  | SetVersionRestoreVisibilityAction
  | SetImportingMeshStateAction
  | SetStoredLayoutsAction;

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

export const setImportingMeshStateAction = (isImporting: boolean): SetImportingMeshStateAction => ({
  type: "SET_IMPORTING_MESH_STATE",
  isImporting,
});

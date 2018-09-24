// @flow
/* eslint-disable import/prefer-default-export */

type SetDropzoneModalVisibilityActionType = {
  type: "SET_DROPZONE_MODAL_VISIBILITY",
  visible: boolean,
};

type SetVersionRestoreVisibilityActionType = {
  type: "SET_VERSION_RESTORE_VISIBILITY",
  active: boolean,
};

export type UiActionType =
  | SetDropzoneModalVisibilityActionType
  | SetVersionRestoreVisibilityActionType;

export const setDropzoneModalVisibilityAction = (
  visible: boolean,
): SetDropzoneModalVisibilityActionType => ({
  type: "SET_DROPZONE_MODAL_VISIBILITY",
  visible,
});

export const setVersionRestoreVisibilityAction = (
  active: boolean,
): SetVersionRestoreVisibilityActionType => ({
  type: "SET_VERSION_RESTORE_VISIBILITY",
  active,
});

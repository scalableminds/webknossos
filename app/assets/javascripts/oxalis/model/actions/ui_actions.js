// @flow
/* eslint-disable import/prefer-default-export */

type SetDropzoneModalVisibilityActionType = {
  type: "SET_DROPZONE_MODAL_VISIBILITY_ACTION_TYPE",
  visible: boolean,
};

type SetVersionRestoreModeActionType = {
  type: "SET_VERSION_RESTORE_MODE_ACTION_TYPE",
  active: boolean,
};

export type UiActionType = SetDropzoneModalVisibilityActionType | SetVersionRestoreModeActionType;

export const setDropzoneModalVisibilityAction = (
  visible: boolean,
): SetDropzoneModalVisibilityActionType => ({
  type: "SET_DROPZONE_MODAL_VISIBILITY_ACTION_TYPE",
  visible,
});

export const setVersionRestoreModeAction = (active: boolean): SetVersionRestoreModeActionType => ({
  type: "SET_VERSION_RESTORE_MODE_ACTION_TYPE",
  active,
});

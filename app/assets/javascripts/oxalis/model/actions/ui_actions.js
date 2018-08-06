// @flow
/* eslint-disable import/prefer-default-export */

type SetDropzoneModalVisibilityActionType = {
  type: "SET_DROPZONE_MODAL_VISIBILITY_ACTION_TYPE",
  visible: boolean,
};

export type UiActionType = SetDropzoneModalVisibilityActionType;

export const setDropzoneModalVisibilityAction = (
  visible: boolean,
): SetDropzoneModalVisibilityActionType => ({
  type: "SET_DROPZONE_MODAL_VISIBILITY_ACTION_TYPE",
  visible,
});

// @flow

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

type SetIsInAnnotationViewAction = {
  type: "SET_IS_IN_ANNOTATION_VIEW",
  value: boolean,
};

type SetHasOrganizationsAction = {
  type: "SET_HAS_ORGANIZATIONS",
  value: boolean,
};

type SetLiveTrainingProgressAction = {
  type: "SET_LIVE_TRAINING_PROGRESS",
  value: number,
};

type SetIsLiveTrainingPredictingAction = {
  type: "SET_IS_LIVE_TRAINING_PREDICTING_ACTION",
  value: boolean,
};

export type UiAction =
  | SetDropzoneModalVisibilityAction
  | SetVersionRestoreVisibilityAction
  | SetImportingMeshStateAction
  | SetStoredLayoutsAction
  | SetIsInAnnotationViewAction
  | SetHasOrganizationsAction
  | SetLiveTrainingProgressAction
  | SetIsLiveTrainingPredictingAction;

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

export const setIsInAnnotationViewAction = (value: boolean): SetIsInAnnotationViewAction => ({
  type: "SET_IS_IN_ANNOTATION_VIEW",
  value,
});

export const setHasOrganizationsAction = (value: boolean): SetHasOrganizationsAction => ({
  type: "SET_HAS_ORGANIZATIONS",
  value,
});

export const setLiveTrainingProgressAction = (value: number): SetLiveTrainingProgressAction => ({
  type: "SET_LIVE_TRAINING_PROGRESS",
  value,
});

export const setIsLiveTrainingPredictingAction = (
  value: boolean,
): SetLiveTrainingProgressAction => ({
  type: "SET_IS_LIVE_TRAINING_PREDICTING_ACTION",
  value,
});

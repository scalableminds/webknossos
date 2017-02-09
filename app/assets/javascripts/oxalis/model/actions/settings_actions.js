/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */

type UpdateUserSettingActionType = {type: "UPDATE_USER_SETTING", propertyName: string, value: any};
type UpdateDatasetSettingActionType = {type: "UPDATE_DATASET_SETTING", propertyName: string, value: any};
type UpdateLayerSettingActionType = {type: "UPDATE_LAYER_SETTING", layerName:string, propertyName: string, value: any};
type InitializeUserSettingsAction = {type: "INITIALIZE_USER_SETTINGS", initialState: Object};
type InitializeDatasetSettingsAction = {type: "INITIALIZE_DATASET_SETTINGS", initialState: Object};
type SetDatasetAction = {type: "SET_DATASET", dataset: Object, dataLayerNames: Array<string>};

export type SettingActionTypes = (
  UpdateUserSettingActionType |
  UpdateDatasetSettingActionType |
  InitializeUserSettingsAction |
  InitializeDatasetSettingsAction |
  UpdateLayerSettingActionType
);

export const updateUserSettingAction = (propertyName: string, value: any): UpdateUserSettingActionType => ({
  type: "UPDATE_USER_SETTING",
  propertyName,
  value,
});

export const updateDatasetSettingAction = (propertyName: string, value: any): UpdateDatasetSettingActionType => ({
  type: "UPDATE_DATASET_SETTING",
  propertyName,
  value,
});

export const updateLayerSettingAction = (layerName: string, propertyName: string, value: any): UpdateLayerSettingActionType => ({
  type: "UPDATE_LAYER_SETTING",
  layerName,
  propertyName,
  value,
});

export const setDatasetAction = (dataset: Object, dataLayerNames: Array<string>): SetDatasetAction => ({
  type: "SET_DATASET",
  dataset,
  dataLayerNames,
});

export const initializeUserSettingsAction = (initialState: Object): InitializeUserSettingsAction => ({
  type: "INITIALIZE_USER_SETTINGS",
  initialState,
});

export const initializeDatasetSettingsAction = (initialState: Object): InitializeDatasetSettingsAction => ({
  type: "INITIALIZE_DATASET_SETTINGS",
  initialState,
});


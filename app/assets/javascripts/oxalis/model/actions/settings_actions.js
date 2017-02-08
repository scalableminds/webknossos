/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */

type UpdateSettingActionType = {type: string, propertyName: string, value: any};
type UpdateLayerSettingActionType = {type: string, layerName:string, propertyName: string, value: any};
type InitializeSettingsAction = {type: string, initialState: Object};
export type SettingActionTypes = (UpdateSettingActionType | InitializeSettingsAction | UpdateLayerSettingActionType);

export const updateSettingAction = (propertyName: string, value: any): UpdateSettingActionType => ({
  type: "UPDATE_USER_SETTING",
  propertyName,
  value,
});

export const updateDatasetSettingAction = (propertyName: string, value: any): UpdateSettingActionType => ({
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

export const initializeUserSettingsAction = (initialState: Object): InitializeSettingsAction => ({
  type: "INITIALIZE_USER_SETTINGS",
  initialState,
});

export const initializeDatasetSettingsAction = (initialState: Object): InitializeSettingsAction => ({
  type: "INITIALIZE_DATASET_SETTINGS",
  initialState,
});


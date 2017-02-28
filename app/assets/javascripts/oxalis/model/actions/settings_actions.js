/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */
import type { UserConfigurationType, DatasetConfigurationType, DatasetLayerConfigurationType, EphemeralConfigurationType, DatasetType } from "oxalis/store";

type UpdateUserSettingActionType = {type: "UPDATE_USER_SETTING", propertyName: $Keys<UserConfigurationType>, value: any};
type UpdateDatasetSettingActionType = {type: "UPDATE_DATASET_SETTING", propertyName: $Keys<DatasetConfigurationType>, value: any};
type UpdateEphemeralSettingActionType = {type: "UPDATE_EPHEMERAL_SETTING", propertyName: $Keys<EphemeralConfigurationType>, value: any};
type UpdateLayerSettingActionType = {type: "UPDATE_LAYER_SETTING", layerName:string, propertyName: $Keys<DatasetLayerConfigurationType>, value: any};
export type InitializeSettingsAction = {type: "INITIALIZE_SETTINGS", initialUserSettings: UserConfigurationType, initialDatasetSettings: DatasetConfigurationType};
type SetDatasetAction = {type: "SET_DATASET", dataset: DatasetType};

export type SettingActionTypes = (
  UpdateUserSettingActionType |
  UpdateDatasetSettingActionType |
  InitializeSettingsAction |
  UpdateLayerSettingActionType
);

export const updateUserSettingAction = (propertyName: $Keys<UserConfigurationType>, value: any): UpdateUserSettingActionType => ({
  type: "UPDATE_USER_SETTING",
  propertyName,
  value,
});

export const updateDatasetSettingAction = (propertyName: $Keys<DatasetConfigurationType>, value: any): UpdateDatasetSettingActionType => ({
  type: "UPDATE_DATASET_SETTING",
  propertyName,
  value,
});

export const updateEphemeralSettingAction = (propertyName: $Keys<EphemeralConfigurationType>, value: any): UpdateEphemeralSettingActionType => ({
  type: "UPDATE_EPHEMERAL_SETTING",
  propertyName,
  value,
});

export const updateLayerSettingAction = (layerName: string, propertyName: $Keys<DatasetLayerConfigurationType>, value: any): UpdateLayerSettingActionType => ({
  type: "UPDATE_LAYER_SETTING",
  layerName,
  propertyName,
  value,
});

export const setDatasetAction = (dataset: DatasetType): SetDatasetAction => ({
  type: "SET_DATASET",
  dataset,
});

export const initializeSettingsAction = (initialUserSettings:Object, initialDatasetSettings: Object): InitializeSettingsAction => ({
  type: "INITIALIZE_SETTINGS",
  initialUserSettings,
  initialDatasetSettings,
});

/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */
import type { APIDataset } from "admin/api_flow_types";
import type { Mode, ControlMode } from "oxalis/constants";
import type {
  UserConfiguration,
  DatasetConfiguration,
  DatasetLayerConfiguration,
  TemporaryConfiguration,
  Mapping,
} from "oxalis/store";

type UpdateUserSettingAction = {
  type: "UPDATE_USER_SETTING",
  propertyName: $Keys<UserConfiguration>,
  value: any,
};
type UpdateDatasetSettingAction = {
  type: "UPDATE_DATASET_SETTING",
  propertyName: $Keys<DatasetConfiguration>,
  value: any,
};
type UpdateTemporarySettingAction = {
  type: "UPDATE_TEMPORARY_SETTING",
  propertyName: $Keys<TemporaryConfiguration>,
  value: any,
};
export type ToggleTemporarySettingAction = {
  type: "TOGGLE_TEMPORARY_SETTING",
  propertyName: $Keys<TemporaryConfiguration>,
};
type UpdateLayerSettingAction = {
  type: "UPDATE_LAYER_SETTING",
  layerName: string,
  propertyName: $Keys<DatasetLayerConfiguration>,
  value: any,
};
export type InitializeSettingsAction = {
  type: "INITIALIZE_SETTINGS",
  initialUserSettings: UserConfiguration,
  initialDatasetSettings: DatasetConfiguration,
};
type SetDatasetAction = { type: "SET_DATASET", dataset: APIDataset };
type SetViewModeAction = { type: "SET_VIEW_MODE", viewMode: Mode };
type SetFlightmodeRecordingAction = { type: "SET_FLIGHTMODE_RECORDING", value: boolean };
type SetControlModeAction = { type: "SET_CONTROL_MODE", controlMode: ControlMode };
type SetMappingEnabledAction = { type: "SET_MAPPING_ENABLED", isMappingEnabled: boolean };
type SetMappingAction = {
  type: "SET_MAPPING",
  mapping: ?Mapping,
  mappingColors: ?Array<number>,
  hideUnmappedIds: ?boolean,
};
export type SettingAction =
  | UpdateUserSettingAction
  | UpdateDatasetSettingAction
  | UpdateTemporarySettingAction
  | ToggleTemporarySettingAction
  | InitializeSettingsAction
  | UpdateLayerSettingAction
  | SetDatasetAction
  | SetViewModeAction
  | SetFlightmodeRecordingAction
  | SetControlModeAction
  | SetMappingEnabledAction
  | SetMappingAction;

export const updateUserSettingAction = (
  propertyName: $Keys<UserConfiguration>,
  value: any,
): UpdateUserSettingAction => ({
  type: "UPDATE_USER_SETTING",
  propertyName,
  value,
});

export const updateDatasetSettingAction = (
  propertyName: $Keys<DatasetConfiguration>,
  value: any,
): UpdateDatasetSettingAction => ({
  type: "UPDATE_DATASET_SETTING",
  propertyName,
  value,
});

export const updateTemporarySettingAction = (
  propertyName: $Keys<TemporaryConfiguration>,
  value: any,
): UpdateTemporarySettingAction => ({
  type: "UPDATE_TEMPORARY_SETTING",
  propertyName,
  value,
});

export const toggleTemporarySettingAction = (
  propertyName: $Keys<TemporaryConfiguration>,
): ToggleTemporarySettingAction => ({
  type: "TOGGLE_TEMPORARY_SETTING",
  propertyName,
});

export const updateLayerSettingAction = (
  layerName: string,
  propertyName: $Keys<DatasetLayerConfiguration>,
  value: any,
): UpdateLayerSettingAction => ({
  type: "UPDATE_LAYER_SETTING",
  layerName,
  propertyName,
  value,
});

export const setDatasetAction = (dataset: APIDataset): SetDatasetAction => ({
  type: "SET_DATASET",
  dataset,
});

export const initializeSettingsAction = (
  initialUserSettings: Object,
  initialDatasetSettings: Object,
): InitializeSettingsAction => ({
  type: "INITIALIZE_SETTINGS",
  initialUserSettings,
  initialDatasetSettings,
});

export const setViewModeAction = (viewMode: Mode): SetViewModeAction => ({
  type: "SET_VIEW_MODE",
  viewMode,
});

export const setFlightmodeRecordingAction = (value: boolean): SetFlightmodeRecordingAction => ({
  type: "SET_FLIGHTMODE_RECORDING",
  value,
});

export const setControlModeAction = (controlMode: ControlMode): SetControlModeAction => ({
  type: "SET_CONTROL_MODE",
  controlMode,
});

export const setMappingEnabledAction = (isMappingEnabled: boolean): SetMappingEnabledAction => ({
  type: "SET_MAPPING_ENABLED",
  isMappingEnabled,
});

export const setMappingAction = (
  mapping: ?Mapping,
  mappingColors: ?Array<number>,
  hideUnmappedIds: ?boolean,
): SetMappingAction => ({
  type: "SET_MAPPING",
  mapping,
  mappingColors,
  hideUnmappedIds,
});

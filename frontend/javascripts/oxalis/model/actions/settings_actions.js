// @flow
import type { ViewMode, ControlMode } from "oxalis/constants";
import type {
  UserConfiguration,
  DatasetConfiguration,
  DatasetLayerConfiguration,
  TemporaryConfiguration,
  Mapping,
  HistogramDataForAllLayers,
  MappingType,
} from "oxalis/store";

export type UpdateUserSettingAction = {
  type: "UPDATE_USER_SETTING",
  propertyName: $Keys<UserConfiguration>,
  value: any,
};
type UpdateDatasetSettingAction = {
  type: "UPDATE_DATASET_SETTING",
  propertyName: $Keys<DatasetConfiguration>,
  value: any,
};
export type UpdateTemporarySettingAction = {
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
type SetViewModeAction = { type: "SET_VIEW_MODE", viewMode: ViewMode };
type SetHistogramDataAction = {
  type: "SET_HISTOGRAM_DATA",
  histogramData: HistogramDataForAllLayers,
};
type SetFlightmodeRecordingAction = { type: "SET_FLIGHTMODE_RECORDING", value: boolean };
type SetControlModeAction = { type: "SET_CONTROL_MODE", controlMode: ControlMode };
type InitializeGpuSetupAction = {
  type: "INITIALIZE_GPU_SETUP",
  bucketCapacity: number,
  gpuFactor: number,
  maximumLayerCountToRender: number,
};
export type SetMappingEnabledAction = {
  type: "SET_MAPPING_ENABLED",
  isMappingEnabled: boolean,
  layerName: string,
};
export type SetMappingAction = {
  type: "SET_MAPPING",
  mappingName: ?string,
  mapping: ?Mapping,
  mappingKeys: ?Array<number>,
  mappingColors: ?Array<number>,
  hideUnmappedIds: ?boolean,
  mappingType: MappingType,
  layerName: string,
  showLoadingIndicator: ?boolean,
};

type SetHideUnmappedIdsAction = {
  type: "SET_HIDE_UNMAPPED_IDS",
  hideUnmappedIds: boolean,
  layerName: string,
};

export type SettingAction =
  | UpdateUserSettingAction
  | UpdateDatasetSettingAction
  | UpdateTemporarySettingAction
  | ToggleTemporarySettingAction
  | InitializeSettingsAction
  | UpdateLayerSettingAction
  | SetViewModeAction
  | SetFlightmodeRecordingAction
  | SetControlModeAction
  | SetMappingEnabledAction
  | SetMappingAction
  | SetHideUnmappedIdsAction
  | SetHistogramDataAction
  | InitializeGpuSetupAction;

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

export const initializeSettingsAction = (
  initialUserSettings: Object,
  initialDatasetSettings: Object,
): InitializeSettingsAction => ({
  type: "INITIALIZE_SETTINGS",
  initialUserSettings,
  initialDatasetSettings,
});

export const setViewModeAction = (viewMode: ViewMode): SetViewModeAction => ({
  type: "SET_VIEW_MODE",
  viewMode,
});

export const setHistogramDataAction = (
  histogramData: HistogramDataForAllLayers,
): SetHistogramDataAction => ({
  type: "SET_HISTOGRAM_DATA",
  histogramData,
});

export const setFlightmodeRecordingAction = (value: boolean): SetFlightmodeRecordingAction => ({
  type: "SET_FLIGHTMODE_RECORDING",
  value,
});

export const setControlModeAction = (controlMode: ControlMode): SetControlModeAction => ({
  type: "SET_CONTROL_MODE",
  controlMode,
});

export const setMappingEnabledAction = (
  layerName: string,
  isMappingEnabled: boolean,
): SetMappingEnabledAction => ({
  type: "SET_MAPPING_ENABLED",
  layerName,
  isMappingEnabled,
});

export type OptionalMappingProperties = {|
  mapping?: Mapping,
  mappingKeys?: Array<number>,
  mappingColors?: Array<number>,
  hideUnmappedIds?: boolean,
  showLoadingIndicator?: boolean,
|};

export const setMappingAction = (
  layerName: string,
  mappingName: ?string,
  mappingType: MappingType = "JSON",
  {
    mapping,
    mappingKeys,
    mappingColors,
    hideUnmappedIds,
    showLoadingIndicator,
  }: OptionalMappingProperties = {},
): SetMappingAction => ({
  type: "SET_MAPPING",
  layerName,
  mappingName,
  mappingType,
  mapping,
  mappingKeys,
  mappingColors,
  hideUnmappedIds,
  showLoadingIndicator,
});

export const setHideUnmappedIdsAction = (
  layerName: string,
  hideUnmappedIds: boolean,
): SetHideUnmappedIdsAction => ({
  type: "SET_HIDE_UNMAPPED_IDS",
  hideUnmappedIds,
  layerName,
});

export const initializeGpuSetupAction = (
  bucketCapacity: number,
  gpuFactor: number,
  maximumLayerCountToRender: number,
): InitializeGpuSetupAction => ({
  type: "INITIALIZE_GPU_SETUP",
  bucketCapacity,
  gpuFactor,
  maximumLayerCountToRender,
});

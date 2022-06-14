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
import Deferred from "libs/deferred";

export type UpdateUserSettingAction = {
  type: "UPDATE_USER_SETTING";
  propertyName: keyof UserConfiguration;
  value: any;
};
type UpdateDatasetSettingAction = {
  type: "UPDATE_DATASET_SETTING";
  propertyName: keyof DatasetConfiguration;
  value: any;
};
export type UpdateTemporarySettingAction = {
  type: "UPDATE_TEMPORARY_SETTING";
  propertyName: keyof TemporaryConfiguration;
  value: any;
};
export type ToggleTemporarySettingAction = {
  type: "TOGGLE_TEMPORARY_SETTING";
  propertyName: keyof TemporaryConfiguration;
};
type UpdateLayerSettingAction = {
  type: "UPDATE_LAYER_SETTING";
  layerName: string;
  propertyName: keyof DatasetLayerConfiguration;
  value: any;
};
export type InitializeSettingsAction = {
  type: "INITIALIZE_SETTINGS";
  initialUserSettings: UserConfiguration;
  initialDatasetSettings: DatasetConfiguration;
  originalDatasetSettings: DatasetConfiguration;
};
type SetViewModeAction = {
  type: "SET_VIEW_MODE";
  viewMode: ViewMode;
};
type SetHistogramDataAction = {
  type: "SET_HISTOGRAM_DATA";
  histogramData: HistogramDataForAllLayers;
};
export type ClipHistogramAction = {
  type: "CLIP_HISTOGRAM";
  layerName: string;
  shouldAdjustClipRange: boolean;
  callback?: () => void;
};
type SetFlightmodeRecordingAction = {
  type: "SET_FLIGHTMODE_RECORDING";
  value: boolean;
};
type SetControlModeAction = {
  type: "SET_CONTROL_MODE";
  controlMode: ControlMode;
};
type InitializeGpuSetupAction = {
  type: "INITIALIZE_GPU_SETUP";
  bucketCapacity: number;
  gpuFactor: number;
  maximumLayerCountToRender: number;
};
export type SetMappingEnabledAction = {
  type: "SET_MAPPING_ENABLED";
  isMappingEnabled: boolean;
  layerName: string;
};
export type SetMappingAction = {
  type: "SET_MAPPING";
  mappingName: string | null | undefined;
  mapping: Mapping | null | undefined;
  mappingKeys: Array<number> | null | undefined;
  mappingColors: Array<number> | null | undefined;
  hideUnmappedIds: boolean | null | undefined;
  mappingType: MappingType;
  layerName: string;
  showLoadingIndicator: boolean | null | undefined;
};
type SetHideUnmappedIdsAction = {
  type: "SET_HIDE_UNMAPPED_IDS";
  hideUnmappedIds: boolean;
  layerName: string;
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
  propertyName: keyof UserConfiguration,
  value: any,
): UpdateUserSettingAction => ({
  type: "UPDATE_USER_SETTING",
  propertyName,
  value,
});
export const updateDatasetSettingAction = (
  propertyName: keyof DatasetConfiguration,
  value: any,
): UpdateDatasetSettingAction => ({
  type: "UPDATE_DATASET_SETTING",
  propertyName,
  value,
});
export const updateTemporarySettingAction = (
  propertyName: keyof TemporaryConfiguration,
  value: any,
): UpdateTemporarySettingAction => ({
  type: "UPDATE_TEMPORARY_SETTING",
  propertyName,
  value,
});
export const toggleTemporarySettingAction = (
  propertyName: keyof TemporaryConfiguration,
): ToggleTemporarySettingAction => ({
  type: "TOGGLE_TEMPORARY_SETTING",
  propertyName,
});
export const updateLayerSettingAction = (
  layerName: string,
  propertyName: keyof DatasetLayerConfiguration,
  value: any,
): UpdateLayerSettingAction => ({
  type: "UPDATE_LAYER_SETTING",
  layerName,
  propertyName,
  value,
});
export const initializeSettingsAction = (
  initialUserSettings: UserConfiguration,
  initialDatasetSettings: DatasetConfiguration,
  originalDatasetSettings: DatasetConfiguration,
): InitializeSettingsAction => ({
  type: "INITIALIZE_SETTINGS",
  initialUserSettings,
  initialDatasetSettings,
  originalDatasetSettings,
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
export const clipHistogramAction = (
  layerName: string,
  shouldAdjustClipRange: boolean,
  callback?: () => void,
): ClipHistogramAction => ({
  type: "CLIP_HISTOGRAM",
  layerName,
  shouldAdjustClipRange,
  callback,
});
export const dispatchClipHistogramAsync = async (
  layerName: string,
  shouldAdjustClipRange: boolean,
  dispatch: (arg0: any) => any,
): Promise<void> => {
  const readyDeferred = new Deferred();
  const action = clipHistogramAction(layerName, shouldAdjustClipRange, () =>
    readyDeferred.resolve(null),
  );
  dispatch(action);
  await readyDeferred.promise();
};
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
export type OptionalMappingProperties = {
  mapping?: Mapping;
  mappingKeys?: Array<number>;
  mappingColors?: Array<number>;
  hideUnmappedIds?: boolean;
  showLoadingIndicator?: boolean;
};
export const setMappingAction = (
  layerName: string,
  mappingName: string | null | undefined,
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

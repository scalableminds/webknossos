import type { ViewMode, ControlMode } from "oxalis/constants";
import type {
  UserConfiguration,
  DatasetConfiguration,
  DatasetLayerConfiguration,
  TemporaryConfiguration,
  Mapping,
  MappingType,
} from "oxalis/store";
import Deferred from "libs/async/deferred";
import { APIHistogramData } from "types/api_flow_types";

export type UpdateUserSettingAction = ReturnType<typeof updateUserSettingAction>;
type UpdateDatasetSettingAction = ReturnType<typeof updateDatasetSettingAction>;
export type UpdateTemporarySettingAction = ReturnType<typeof updateTemporarySettingAction>;
export type ToggleTemporarySettingAction = ReturnType<typeof toggleTemporarySettingAction>;
type UpdateLayerSettingAction = ReturnType<typeof updateLayerSettingAction>;
export type InitializeSettingsAction = ReturnType<typeof initializeSettingsAction>;
type SetViewModeAction = ReturnType<typeof setViewModeAction>;
type SetHistogramDataForLayerAction = ReturnType<typeof setHistogramDataForLayerAction>;
export type ReloadHistogramAction = ReturnType<typeof reloadHistogramAction>;
export type ClipHistogramAction = ReturnType<typeof clipHistogramAction>;
type SetFlightmodeRecordingAction = ReturnType<typeof setFlightmodeRecordingAction>;
type SetControlModeAction = ReturnType<typeof setControlModeAction>;
type InitializeGpuSetupAction = ReturnType<typeof initializeGpuSetupAction>;
export type SetMappingEnabledAction = ReturnType<typeof setMappingEnabledAction>;
export type SetMappingAction = ReturnType<typeof setMappingAction>;
export type SetMappingNameAction = ReturnType<typeof setMappingNameAction>;
type SetHideUnmappedIdsAction = ReturnType<typeof setHideUnmappedIdsAction>;

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
  | SetMappingNameAction
  | SetHideUnmappedIdsAction
  | SetHistogramDataForLayerAction
  | ReloadHistogramAction
  | InitializeGpuSetupAction;

export const updateUserSettingAction = <Key extends keyof UserConfiguration>(
  propertyName: Key,
  value: UserConfiguration[Key],
) =>
  ({
    type: "UPDATE_USER_SETTING",
    propertyName,
    value,
  }) as const;

export const updateDatasetSettingAction = <Key extends keyof DatasetConfiguration>(
  propertyName: Key,
  value: DatasetConfiguration[Key],
) =>
  ({
    type: "UPDATE_DATASET_SETTING",
    propertyName,
    value,
  }) as const;

export const updateTemporarySettingAction = <Key extends keyof TemporaryConfiguration>(
  propertyName: Key,
  value: TemporaryConfiguration[Key],
) =>
  ({
    type: "UPDATE_TEMPORARY_SETTING",
    propertyName,
    value,
  }) as const;

export const toggleTemporarySettingAction = (propertyName: keyof TemporaryConfiguration) =>
  ({
    type: "TOGGLE_TEMPORARY_SETTING",
    propertyName,
  }) as const;

export const updateLayerSettingAction = <Key extends keyof DatasetLayerConfiguration>(
  layerName: string,
  propertyName: Key,
  value: DatasetLayerConfiguration[Key],
) =>
  ({
    type: "UPDATE_LAYER_SETTING",
    layerName,
    propertyName,
    value,
  }) as const;

export const initializeSettingsAction = (
  initialUserSettings: UserConfiguration,
  initialDatasetSettings: DatasetConfiguration,
  originalDatasetSettings: DatasetConfiguration,
) =>
  ({
    type: "INITIALIZE_SETTINGS",
    initialUserSettings,
    initialDatasetSettings,
    originalDatasetSettings,
  }) as const;

export const setViewModeAction = (viewMode: ViewMode) =>
  ({
    type: "SET_VIEW_MODE",
    viewMode,
  }) as const;

export const setHistogramDataForLayerAction = (
  layerName: string,
  histogramData: APIHistogramData | null | undefined,
) =>
  ({
    type: "SET_HISTOGRAM_DATA_FOR_LAYER",
    layerName,
    histogramData,
  }) as const;

export const clipHistogramAction = (
  layerName: string,
  shouldAdjustClipRange: boolean,
  callback?: () => void,
) =>
  ({
    type: "CLIP_HISTOGRAM",
    layerName,
    shouldAdjustClipRange,
    callback,
  }) as const;

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

export const reloadHistogramAction = (layerName: string) =>
  ({
    type: "RELOAD_HISTOGRAM",
    layerName,
  }) as const;

export const setFlightmodeRecordingAction = (value: boolean) =>
  ({
    type: "SET_FLIGHTMODE_RECORDING",
    value,
  }) as const;

export const setControlModeAction = (controlMode: ControlMode) =>
  ({
    type: "SET_CONTROL_MODE",
    controlMode,
  }) as const;

export const setMappingEnabledAction = (layerName: string, isMappingEnabled: boolean) =>
  ({
    type: "SET_MAPPING_ENABLED",
    layerName,
    isMappingEnabled,
  }) as const;

export type OptionalMappingProperties = {
  mapping?: Mapping;
  mappingColors?: Array<number>;
  hideUnmappedIds?: boolean;
  showLoadingIndicator?: boolean;
};
export const setMappingAction = (
  layerName: string,
  mappingName: string | null | undefined,
  mappingType: MappingType = "JSON",
  { mapping, mappingColors, hideUnmappedIds, showLoadingIndicator }: OptionalMappingProperties = {},
) =>
  ({
    type: "SET_MAPPING",
    layerName,
    mappingName,
    mappingType,
    mapping,
    mappingColors,
    hideUnmappedIds,
    showLoadingIndicator,
  }) as const;

export const setMappingNameAction = (
  layerName: string,
  mappingName: string,
  mappingType: MappingType,
) =>
  ({
    type: "SET_MAPPING_NAME",
    layerName,
    mappingName,
    mappingType,
  }) as const;

export const setHideUnmappedIdsAction = (layerName: string, hideUnmappedIds: boolean) =>
  ({
    type: "SET_HIDE_UNMAPPED_IDS",
    hideUnmappedIds,
    layerName,
  }) as const;

export const initializeGpuSetupAction = (
  bucketCapacity: number,
  gpuFactor: number,
  maximumLayerCountToRender: number,
) =>
  ({
    type: "INITIALIZE_GPU_SETUP",
    bucketCapacity,
    gpuFactor,
    maximumLayerCountToRender,
  }) as const;

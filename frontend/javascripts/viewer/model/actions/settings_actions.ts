import Deferred from "libs/async/deferred";
import type { APIHistogramData } from "types/api_types";
import type { ControlMode, ViewMode } from "viewer/constants";
import type {
  DatasetConfiguration,
  DatasetLayerConfiguration,
  Mapping,
  MappingType,
  TemporaryConfiguration,
  UserConfiguration,
} from "viewer/store";
import type {
  KeyboardShortcutsMap,
  UnmodifiedLayoutMap,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_types";

export type UpdateUserSettingAction = ReturnType<typeof updateUserSettingAction>;
type UpdateDatasetSettingAction = ReturnType<typeof updateDatasetSettingAction>;
export type UpdateTemporarySettingAction = ReturnType<typeof updateTemporarySettingAction>;
export type ToggleTemporarySettingAction = ReturnType<typeof toggleTemporarySettingAction>;
export type UpdateLayerSettingAction = ReturnType<typeof updateLayerSettingAction>;
export type InitializeSettingsAction = ReturnType<typeof initializeSettingsAction>;
export type SetViewModeAction = ReturnType<typeof setViewModeAction>;
type SetHistogramDataForLayerAction = ReturnType<typeof setHistogramDataForLayerAction>;
export type ReloadHistogramAction = ReturnType<typeof reloadHistogramAction>;
export type ClipHistogramAction = ReturnType<typeof clipHistogramAction>;
type SetFlightmodeRecordingAction = ReturnType<typeof setFlightmodeRecordingAction>;
type SetControlModeAction = ReturnType<typeof setControlModeAction>;
type InitializeGpuSetupAction = ReturnType<typeof initializeGpuSetupAction>;
export type SetMappingEnabledAction = ReturnType<typeof setMappingEnabledAction>;
export type FinishMappingInitializationAction = ReturnType<
  typeof finishMappingInitializationAction
>;
export type ClearMappingAction = ReturnType<typeof clearMappingAction>;
export type SetMappingAction = ReturnType<typeof setMappingAction>;
export type SetMappingDataAction = ReturnType<typeof setMappingDataAction>;
export type SetMappingNameAction = ReturnType<typeof setMappingNameAction>;
type SetHideUnmappedIdsAction = ReturnType<typeof setHideUnmappedIdsAction>;
export type SetKeyboardShortcutsConfigAction = ReturnType<typeof setKeyboardShortcutsConfigAction>;
export type SetKeyboardLayoutMapAction = ReturnType<typeof setKeyboardLayoutMapAction>;
export type SetKeyboardLayoutMapEntryAction = ReturnType<typeof setKeyboardLayoutMapEntryAction>;

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
  | FinishMappingInitializationAction
  | ClearMappingAction
  | SetMappingAction
  | SetMappingDataAction
  | SetMappingNameAction
  | SetHideUnmappedIdsAction
  | SetHistogramDataForLayerAction
  | ReloadHistogramAction
  | InitializeGpuSetupAction
  | SetKeyboardShortcutsConfigAction
  | SetKeyboardLayoutMapAction
  | SetKeyboardLayoutMapEntryAction;

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

const toggleTemporarySettingAction = (propertyName: keyof TemporaryConfiguration) =>
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

export const finishMappingInitializationAction = (layerName: string) =>
  ({
    type: "FINISH_MAPPING_INITIALIZATION",
    layerName,
  }) as const;

// This is not the same as disabling a mapping. A disabled mapping can simply be re-enabled.
// Clearing a mapping sets the mapping dictionary to undefined. This is important when a
// locally applied mapping should no longer be applied locally but by the back-end. In that case,
// the mapping is still enabled, but we want to clear the local mapping dictionary.
export const clearMappingAction = (layerName: string) =>
  ({
    type: "CLEAR_MAPPING",
    layerName,
  }) as const;

// Properties of a mapping that carry actual mapping data. Used by setMappingDataAction
// and by the setCustomColors helper (which only reads mapping + mappingColors).
export type OptionalMappingProperties = {
  mapping?: Mapping;
  mappingColors?: Array<number>;
  hideUnmappedIds?: boolean;
  isMergerModeMapping?: boolean;
};

// Phase 1 of activating a mapping by name: requests that the mapping becomes active, without
// carrying its data (cf. mapping_saga.ts). The mapping saga loads the data and then dispatches
// setMappingDataAction (phase 2). This is the only action that configures the active mapping's
// name and type — setMappingDataAction merely updates the data of the mapping configured here.
export const setMappingAction = (
  layerName: string,
  mappingName: string | null | undefined,
  mappingType: MappingType = "JSON",
  // If true, the mapping saga automatically makes sure that the new mapping info is stored in RebaseRelevantAnnotationState
  // for future rebases. Only set to true, if this info is really stored this was on the server.
  isVersionStoredOnServer: boolean,
  {
    hideUnmappedIds,
    showLoadingIndicator,
    isMergerModeMapping,
    dataIsProvidedExternally,
  }: {
    hideUnmappedIds?: boolean;
    showLoadingIndicator?: boolean;
    isMergerModeMapping?: boolean;
    // If true, the caller supplies the mapping data itself via a follow-up setMappingDataAction
    // (e.g. the front-end API / merger mode), so the mapping saga must NOT try to load it from the
    // server. This action then only configures name/type/status in the store.
    dataIsProvidedExternally?: boolean;
  } = {},
) =>
  ({
    type: "SET_MAPPING",
    layerName,
    mappingName,
    mappingType,
    hideUnmappedIds,
    showLoadingIndicator,
    isMergerModeMapping,
    dataIsProvidedExternally,
    isVersionStoredOnServer,
  }) as const;

// Updates the DATA of the layer's already-configured active mapping.
// The mapping dictionary is stored and the status is set to ACTIVATING;
// finishMappingActivation in the mapping saga sets it to ENABLED once the
// textures have been updated. See the two-case explanation in mapping_saga.ts.
export const setMappingDataAction = (
  layerName: string,
  mapping: Mapping,
  isVersionStoredOnServer: boolean, // same as in setMappingAction (see above).
  {
    mappingColors,
    hideUnmappedIds,
    isMergerModeMapping,
  }: {
    mappingColors?: Array<number>;
    hideUnmappedIds?: boolean;
    isMergerModeMapping?: boolean;
  } = {},
) =>
  ({
    type: "SET_MAPPING_DATA",
    layerName,
    mapping,
    mappingColors,
    hideUnmappedIds,
    isMergerModeMapping,
    isVersionStoredOnServer,
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

export const setKeyboardShortcutsConfigAction = (shortcuts: KeyboardShortcutsMap) =>
  ({
    type: "SET_KEYBOARD_SHORTCUTS_CONFIG",
    shortcuts,
  }) as const;

export const setKeyboardLayoutMapAction = (map: UnmodifiedLayoutMap) =>
  ({
    type: "SET_KEYBOARD_LAYOUT_MAP",
    map,
  }) as const;

export const setKeyboardLayoutMapEntryAction = (code: string, key: string) =>
  ({
    type: "SET_KEYBOARD_LAYOUT_MAP_ENTRY",
    code,
    key,
  }) as const;

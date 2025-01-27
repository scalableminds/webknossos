import { clamp } from "libs/utils";
import { MappingStatusEnum } from "oxalis/constants";
import {
  getLayerByName,
  getMappingInfo,
  getSegmentationLayers,
  getVisibleSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import {
  hasEditableMapping,
  isMappingActivationAllowed,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { Action } from "oxalis/model/actions/actions";
import { updateKey, updateKey2, updateKey3 } from "oxalis/model/helpers/deep_update";
import type { ActiveMappingInfo, OxalisState } from "oxalis/store";
import { userSettings } from "types/schemas/user_settings.schema";
import { setRotationReducer } from "./flycam_reducer";

//
// Update helpers
//
const updateUserConfig = (
  state: OxalisState,
  shape: Partial<OxalisState["userConfiguration"]>,
): OxalisState => updateKey(state, "userConfiguration", shape);

const updateDatasetConfig = (
  state: OxalisState,
  shape: Partial<OxalisState["datasetConfiguration"]>,
) => updateKey(state, "datasetConfiguration", shape);

const updateTemporaryConfig = (
  state: OxalisState,
  shape: Partial<OxalisState["temporaryConfiguration"]>,
) => updateKey(state, "temporaryConfiguration", shape);

const updateActiveMapping = (
  state: OxalisState,
  shape: Partial<ActiveMappingInfo>,
  layerName: string,
) => {
  const oldMappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    layerName,
  );
  const newMappingInfo = { ...oldMappingInfo, ...shape };
  return updateKey3(
    state,
    "temporaryConfiguration",
    "activeMappingByLayer",
    layerName,
    newMappingInfo,
  );
};

function disableAllSegmentationLayers(state: OxalisState): OxalisState {
  let newState = state;

  for (const segmentationLayer of getSegmentationLayers(state.dataset)) {
    newState = updateKey3(newState, "datasetConfiguration", "layers", segmentationLayer.name, {
      isDisabled: true,
    });
  }

  return newState;
}

function ensureOnlyOneVisibleSegmentationLayer(state: OxalisState): OxalisState {
  const visibleSegmentationLayers = getVisibleSegmentationLayers(state);

  if (visibleSegmentationLayers.length === 0) {
    return state;
  }

  const firstSegmentationLayer = visibleSegmentationLayers[0];
  let newState = updateKey(state, "temporaryConfiguration", {
    lastVisibleSegmentationLayerName: firstSegmentationLayer.name,
  });

  if (visibleSegmentationLayers.length === 1) {
    // Only one segmentation layer is visible, anyways.
    return newState;
  }

  newState = disableAllSegmentationLayers(newState);
  return updateKey3(newState, "datasetConfiguration", "layers", firstSegmentationLayer.name, {
    isDisabled: false,
  });
}

//
// Reducer
//
function SettingsReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "UPDATE_USER_SETTING": {
      const { propertyName } = action;
      let { value } = action;
      // @ts-ignore The in-check should guard against any problems while accessing userSettings
      const settingSpec = propertyName in userSettings ? userSettings[propertyName] : null;

      if (settingSpec != null && settingSpec.type === "number") {
        const min = "minimum" in settingSpec ? settingSpec.minimum : Number.NEGATIVE_INFINITY;
        const max = "maximum" in settingSpec ? settingSpec.maximum : Number.POSITIVE_INFINITY;
        // @ts-ignore Since settingSpec.type === "number", value will be a number
        value = clamp(min, value, max);

        if ("dynamicMaximumFn" in settingSpec) {
          const dynamicMaximum = settingSpec.dynamicMaximumFn(state);
          value = Math.min(value, dynamicMaximum);
        }
      }

      return updateUserConfig(state, {
        [propertyName]: value,
      });
    }

    case "UPDATE_DATASET_SETTING": {
      const { propertyName, value } = action;
      return updateDatasetConfig(state, {
        [propertyName]: value,
      });
    }

    case "UPDATE_TEMPORARY_SETTING": {
      const { propertyName, value } = action;
      return updateTemporaryConfig(state, {
        [propertyName]: value,
      });
    }

    case "TOGGLE_TEMPORARY_SETTING": {
      const { propertyName } = action;
      const value: any = !state.temporaryConfiguration[propertyName];
      return updateTemporaryConfig(state, {
        [propertyName]: value,
      });
    }

    case "UPDATE_LAYER_SETTING": {
      const { layerName, propertyName, value } = action;
      let newState = state;

      if (
        getLayerByName(state.dataset, layerName).category === "segmentation" &&
        propertyName === "isDisabled" &&
        !value
      ) {
        // A segmentation layer is about to be enabled. Disable all (other) segmentation layers
        // so that only the requested layer is enabled.
        newState = disableAllSegmentationLayers(newState);
        newState = updateKey(newState, "temporaryConfiguration", {
          lastVisibleSegmentationLayerName: layerName,
        });
      }

      return updateKey3(newState, "datasetConfiguration", "layers", layerName, {
        [propertyName]: value,
      });
    }

    case "SET_MOUSE_POSITION": {
      return updateTemporaryConfig(state, {
        mousePosition: action.position,
      });
    }

    case "INITIALIZE_SETTINGS": {
      const newState = {
        ...state,
        datasetConfiguration: { ...state.datasetConfiguration, ...action.initialDatasetSettings },
        userConfiguration: { ...state.userConfiguration, ...action.initialUserSettings },
      };
      return ensureOnlyOneVisibleSegmentationLayer(newState);
    }

    case "SET_VIEW_MODE": {
      const { allowedModes } = state.tracing.restrictions;

      if (allowedModes.includes(action.viewMode)) {
        const newState = updateTemporaryConfig(state, {
          viewMode: action.viewMode,
        });
        if (action.viewMode !== "orthogonal") {
          return newState;
        }
        // Restore rotation because it might have been changed by the user
        // in flight/oblique mode. Since this affects the matrix (which is
        // also used in orthogonal mode), the rotation needs to be reset.
        return setRotationReducer(newState, [0, 0, 0]);
      } else {
        return state;
      }
    }

    case "SET_HISTOGRAM_DATA_FOR_LAYER": {
      return updateKey2(state, "temporaryConfiguration", "histogramData", {
        [action.layerName]: action.histogramData,
      });
    }

    case "SET_FLIGHTMODE_RECORDING": {
      return updateTemporaryConfig(state, {
        flightmodeRecording: action.value,
      });
    }

    case "SET_CONTROL_MODE": {
      return updateTemporaryConfig(state, {
        controlMode: action.controlMode,
      });
    }

    case "INITIALIZE_GPU_SETUP": {
      return updateTemporaryConfig(state, {
        gpuSetup: {
          smallestCommonBucketCapacity: action.bucketCapacity,
          initializedGpuFactor: action.gpuFactor,
          maximumLayerCountToRender: action.maximumLayerCountToRender,
        },
      });
    }

    case "FINISH_MAPPING_INITIALIZATION": {
      const { layerName } = action;
      return updateActiveMapping(
        state,
        {
          mappingStatus: MappingStatusEnum.ENABLED,
        },
        layerName,
      );
    }
    case "SET_MAPPING_ENABLED": {
      const { isMappingEnabled, layerName } = action;

      // Editable mappings cannot be disabled or switched for now
      const isEditableMappingActive = hasEditableMapping(state, layerName);
      if (isEditableMappingActive && !action.isMappingEnabled) return state;

      return updateActiveMapping(
        state,
        {
          mappingStatus: isMappingEnabled ? MappingStatusEnum.ENABLED : MappingStatusEnum.DISABLED,
        },
        layerName,
      );
    }

    case "SET_HIDE_UNMAPPED_IDS": {
      const { hideUnmappedIds, layerName } = action;
      return updateActiveMapping(
        state,
        {
          hideUnmappedIds,
        },
        layerName,
      );
    }

    case "SET_MAPPING": {
      const { mappingName, mapping, mappingColors, mappingType, layerName, isMergerModeMapping } =
        action;

      // Editable mappings cannot be disabled or switched for now
      if (!isMappingActivationAllowed(state, mappingName, layerName, !!isMergerModeMapping))
        return state;

      const hideUnmappedIds =
        action.hideUnmappedIds != null
          ? action.hideUnmappedIds
          : getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName)
              .hideUnmappedIds;
      return updateActiveMapping(
        state,
        {
          mappingName,
          mapping,
          mappingColors,
          mappingType,
          hideUnmappedIds,
          mappingStatus:
            mappingName != null ? MappingStatusEnum.ACTIVATING : MappingStatusEnum.DISABLED,
          isMergerModeMapping,
        },
        layerName,
      );
    }

    case "CLEAR_MAPPING": {
      const { layerName } = action;

      return updateActiveMapping(
        state,
        {
          mapping: undefined,
        },
        layerName,
      );
    }

    case "SET_MAPPING_NAME": {
      const { mappingName, layerName } = action;

      // Editable mappings cannot be disabled or switched for now
      if (!isMappingActivationAllowed(state, mappingName, layerName)) return state;

      return updateActiveMapping(state, { mappingName }, layerName);
    }

    default: // pass;
  }

  return state;
}

export default SettingsReducer;

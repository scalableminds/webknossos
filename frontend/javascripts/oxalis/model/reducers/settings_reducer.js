// @flow
import _ from "lodash";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";
import {
  updateKey,
  updateKey2,
  updateKey3,
  type StateShape1,
  type StateShape2,
} from "oxalis/model/helpers/deep_update";
import { clamp } from "libs/utils";
import { getDefaultIntensityRangeOfLayer } from "oxalis/model/accessors/dataset_accessor";
import { userSettings } from "libs/user_settings.schema";

//
// Update helpers
//

const updateUserConfig = (
  state: OxalisState,
  shape: StateShape1<"userConfiguration">,
): OxalisState => updateKey(state, "userConfiguration", shape);

const updateDatasetConfig = (state: OxalisState, shape: StateShape1<"datasetConfiguration">) =>
  updateKey(state, "datasetConfiguration", shape);

const updateTemporaryConfig = (state: OxalisState, shape: StateShape1<"temporaryConfiguration">) =>
  updateKey(state, "temporaryConfiguration", shape);

const updateActiveMapping = (
  state: OxalisState,
  shape: StateShape2<"temporaryConfiguration", "activeMapping">,
) => updateKey2(state, "temporaryConfiguration", "activeMapping", shape);

//
// Reducer
//

function SettingsReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "UPDATE_USER_SETTING": {
      const { propertyName } = action;
      let { value } = action;

      const settingSpec = userSettings[propertyName];
      if (settingSpec != null && settingSpec.type === "number") {
        const min = settingSpec.minimum != null ? settingSpec.minimum : -Infinity;
        const max = settingSpec.maximum != null ? settingSpec.maximum : Infinity;
        value = clamp(min, value, max);
      }

      // $FlowFixMe Flow doesn't check that only numbers will be clamped
      return updateUserConfig(state, { [propertyName]: value });
    }

    case "UPDATE_DATASET_SETTING": {
      const { propertyName, value } = action;
      return updateDatasetConfig(state, { [propertyName]: value });
    }

    case "UPDATE_TEMPORARY_SETTING": {
      const { propertyName, value } = action;
      return updateTemporaryConfig(state, { [propertyName]: value });
    }

    case "TOGGLE_TEMPORARY_SETTING": {
      const { propertyName } = action;
      const value: any = !state.temporaryConfiguration[propertyName];
      return updateTemporaryConfig(state, { [propertyName]: value });
    }

    case "UPDATE_LAYER_SETTING": {
      const { layerName, propertyName, value } = action;
      return updateKey3(state, "datasetConfiguration", "layers", layerName, {
        [propertyName]: value,
      });
    }

    case "SET_MOUSE_POSITION": {
      return updateTemporaryConfig(state, { mousePosition: action.position });
    }

    case "INITIALIZE_SETTINGS": {
      const initialLayerSettings = action.initialDatasetSettings.layers || {};
      const layerSettingsDefaults = _.transform(
        state.dataset.dataSource.dataLayers,
        (result, layer) => {
          const intensityRange = getDefaultIntensityRangeOfLayer(state.dataset, layer.name);
          result[layer.name] = Object.assign(
            {},
            {
              brightness: 0,
              contrast: 1,
              color: [255, 255, 255],
              alpha: layer.category === "color" ? 100 : 20,
              intensityRange,
              isDisabled: false,
              isInverted: false,
            },
            initialLayerSettings[layer.name],
          );
        },
        {},
      );

      const initialDatasetSettingsWithDefaults = Object.assign({}, action.initialDatasetSettings, {
        layers: layerSettingsDefaults,
      });

      return {
        ...state,
        datasetConfiguration: {
          ...state.datasetConfiguration,
          ...initialDatasetSettingsWithDefaults,
        },
        userConfiguration: {
          ...state.userConfiguration,
          ...action.initialUserSettings,
        },
      };
    }
    case "SET_VIEW_MODE": {
      const { allowedModes } = state.tracing.restrictions;
      if (allowedModes.includes(action.viewMode)) {
        return updateTemporaryConfig(state, { viewMode: action.viewMode });
      } else {
        return state;
      }
    }
    case "SET_HISTOGRAM_DATA": {
      return updateTemporaryConfig(state, { histogramData: action.histogramData });
    }
    case "SET_FLIGHTMODE_RECORDING": {
      return updateTemporaryConfig(state, { flightmodeRecording: action.value });
    }
    case "SET_CONTROL_MODE": {
      return updateTemporaryConfig(state, { controlMode: action.controlMode });
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
    case "SET_MAPPING_ENABLED": {
      const { isMappingEnabled } = action;
      return updateActiveMapping(state, {
        isMappingEnabled,
      });
    }
    case "SET_MAPPING": {
      const { mappingName, mapping, mappingKeys, mappingColors, mappingType } = action;
      return updateActiveMapping(state, {
        mappingName,
        mapping,
        mappingKeys,
        mappingColors,
        mappingType,
        mappingSize: action.mappingKeys != null ? action.mappingKeys.length : 0,
        hideUnmappedIds: action.hideUnmappedIds || false,
      });
    }
    default:
    // pass;
  }

  return state;
}

export default SettingsReducer;

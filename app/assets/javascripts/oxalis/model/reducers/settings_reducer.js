/**
 * settings_reducer.js
 * @flow
 */

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
      const { propertyName, value } = action;

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
      // Only color layers need layer settings
      const colorLayers = _.filter(
        state.dataset.dataSource.dataLayers,
        layer => layer.category === "color",
      );
      const initialLayerSettings = action.initialDatasetSettings.layers;
      const layerSettingsDefaults = _.transform(
        colorLayers,
        (result, layer) => {
          if (initialLayerSettings != null && initialLayerSettings[layer.name] != null) {
            result[layer.name] = initialLayerSettings[layer.name];
            if (initialLayerSettings[layer.name].alpha == null) result[layer.name].alpha = 100;
          } else {
            // Set defaults for each layer without settings
            result[layer.name] = {
              brightness: 0,
              contrast: 1,
              color: [255, 255, 255],
              alpha: 100,
            };
          }
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

    case "SET_DATASET": {
      const { dataset } = action;
      return {
        ...state,
        dataset,
      };
    }

    case "SET_VIEW_MODE": {
      const allowedModes = state.tracing.restrictions.allowedModes;
      if (allowedModes.includes(action.viewMode)) {
        return updateTemporaryConfig(state, { viewMode: action.viewMode });
      } else {
        return state;
      }
    }
    case "SET_FLIGHTMODE_RECORDING": {
      return updateTemporaryConfig(state, { flightmodeRecording: action.value });
    }
    case "SET_CONTROL_MODE": {
      return updateTemporaryConfig(state, { controlMode: action.controlMode });
    }
    case "SET_MAPPING_ENABLED": {
      const { isMappingEnabled } = action;
      return updateActiveMapping(state, {
        isMappingEnabled,
      });
    }
    case "SET_MAPPING": {
      return updateActiveMapping(state, {
        mappingSize: action.mapping != null ? _.size(action.mapping) : 0,
        mapping: action.mapping,
        mappingColors: action.mappingColors,
        hideUnmappedIds: action.hideUnmappedIds || false,
      });
    }
    default:
    // pass;
  }

  return state;
}

export default SettingsReducer;

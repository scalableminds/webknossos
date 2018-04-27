/**
 * settings_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { ActionType } from "oxalis/model/actions/actions";

function SettingsReducer(state: OxalisState, action: ActionType): OxalisState {
  switch (action.type) {
    case "UPDATE_USER_SETTING": {
      const { propertyName, value } = action;
      return update(state, { userConfiguration: { [propertyName]: { $set: value } } });
    }

    case "UPDATE_DATASET_SETTING": {
      const { propertyName, value } = action;
      return update(state, { datasetConfiguration: { [propertyName]: { $set: value } } });
    }

    case "UPDATE_TEMPORARY_SETTING": {
      const { propertyName, value } = action;
      return update(state, { temporaryConfiguration: { [propertyName]: { $set: value } } });
    }

    case "TOGGLE_TEMPORARY_SETTING": {
      const { propertyName } = action;
      const value = !state.temporaryConfiguration[propertyName];
      return update(state, { temporaryConfiguration: { [propertyName]: { $set: value } } });
    }

    case "UPDATE_LAYER_SETTING": {
      const { layerName, propertyName, value } = action;
      return update(state, {
        datasetConfiguration: { layers: { [layerName]: { [propertyName]: { $set: value } } } },
      });
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
          } else {
            // Set defaults for each layer without settings
            result[layer.name] = {
              brightness: 0,
              contrast: 1,
              color: [255, 255, 255],
            };
          }
        },
        {},
      );

      const initialDatasetSettingsWithDefaults = Object.assign({}, action.initialDatasetSettings, {
        layers: layerSettingsDefaults,
      });

      return update(state, {
        datasetConfiguration: { $merge: initialDatasetSettingsWithDefaults },
        userConfiguration: { $merge: action.initialUserSettings },
      });
    }

    case "SET_DATASET": {
      return update(state, {
        dataset: { $set: action.dataset },
      });
    }

    case "SET_VIEW_MODE": {
      const allowedModes = state.tracing.restrictions.allowedModes;
      if (allowedModes.includes(action.viewMode)) {
        return update(state, {
          temporaryConfiguration: { viewMode: { $set: action.viewMode } },
        });
      } else {
        return state;
      }
    }
    case "SET_FLIGHTMODE_RECORDING": {
      return update(state, {
        temporaryConfiguration: { flightmodeRecording: { $set: action.value } },
      });
    }
    case "SET_CONTROL_MODE": {
      return update(state, {
        temporaryConfiguration: { controlMode: { $set: action.controlMode } },
      });
    }
    case "SET_MAPPING_ENABLED": {
      return update(state, {
        temporaryConfiguration: { isMappingEnabled: { $set: action.isMappingEnabled } },
      });
    }
    case "SET_MAPPING_SIZE": {
      return update(state, {
        temporaryConfiguration: { mappingSize: { $set: action.mappingSize } },
      });
    }
    default:
    // pass;
  }

  return state;
}

export default SettingsReducer;

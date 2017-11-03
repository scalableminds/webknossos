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
      return update(state, {
        datasetConfiguration: { $merge: action.initialDatasetSettings },
        userConfiguration: { $merge: action.initialUserSettings },
      });
    }

    case "SET_DATASET": {
      const dataset = {
        dataStore: action.dataset.dataStore,
        name: action.dataset.dataSource.id.name,
        scale: action.dataset.dataSource.scale,
        dataLayers: action.dataset.dataSource.dataLayers,
      };

      // set defaults for every data layer if not yet present
      if (_.isEmpty(state.datasetConfiguration.layers)) {
        const colorLayers = _.filter(dataset.dataLayers, layer => layer.category === "color");
        const layerSettingsDefaults = _.transform(
          colorLayers,
          (result, layer) => {
            result[layer.name] = {
              brightness: 0,
              contrast: 1,
              color: [255, 255, 255],
            };
          },
          {},
        );

        return update(state, {
          datasetConfiguration: { layers: { $set: layerSettingsDefaults } },
          dataset: { $set: dataset },
        });
      }

      return update(state, {
        dataset: { $set: dataset },
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
    default:
    // pass;
  }

  return state;
}

export default SettingsReducer;

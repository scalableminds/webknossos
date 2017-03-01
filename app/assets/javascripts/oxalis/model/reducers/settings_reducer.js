/**
 * settings_reducer.js
 * @flow
 */

import _ from "lodash";
import update from "immutability-helper";
import type { OxalisState } from "oxalis/store";
import type { SettingActionTypes } from "oxalis/model/actions/settings_actions";

function SettingsReducer(state: OxalisState, action: SettingActionTypes): OxalisState {
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

    case "UPDATE_LAYER_SETTING": {
      const { layerName, propertyName, value } = action;
      return update(state, { datasetConfiguration: { layers: { [layerName]: { [propertyName]: { $set: value } } } } });
    }

    case "INITIALIZE_SETTINGS": {
      return update(state, {
        datasetConfiguration: { $merge: action.initialDatasetSettings },
        userConfiguration: { $merge: action.initialUserSettings },
      });
    }

    case "SET_DATASET": {
      // set defaults for every data layer if not yet present
      if (_.isEmpty(state.datasetConfiguration.layers)) {
        const colorLayers = _.filter(action.dataset.dataLayers, layer => layer.category === "color");
        const layerSettingsDefaults = _.transform(colorLayers, (result, layer) => {
          result[layer.name] = ({
            brightness: 0,
            contrast: 1,
            color: [255, 255, 255],
          });
        }, {});

        return update(state, {
          datasetConfiguration: { layers: { $set: layerSettingsDefaults } },
          dataset: { $set: action.dataset },
        });
      }

      return update(state, {
        dataset: { $set: action.dataset },
      });
    }

    default:
      // pass;
  }

  return state;
}

export default SettingsReducer;

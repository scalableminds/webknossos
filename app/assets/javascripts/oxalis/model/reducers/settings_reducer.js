/**
 * settings_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { SettingActionTypes } from "oxalis/model/actions/settings_actions";

const SettingsReducer = (state: Object = {}, action: SettingActionTypes) => {
  switch (action.type) {
    case "UPDATE_USER_SETTING": {
      const { propertyName, value } = action;
      return update(state, { userConfiguration: { [propertyName]: { $set: value } } });
    }

    case "UPDATE_DATASET_SETTING": {
      const { propertyName, value } = action;
      return update(state, { datasetConfiguration: { [propertyName]: { $set: value } } });
    }

    case "UPDATE_LAYER_SETTING": {
      const { layerName, propertyName, value } = action;
      return update(state, { datasetConfiguration: { layers: { [layerName]: { [propertyName]: { $set: value } } } } });
    }

    case "INITIALIZE_USER_SETTINGS": {
      return update(state, { userConfiguration: { $set: action.initialState } });
    }

    case "INITIALIZE_DATASET_SETTINGS": {
      return update(state, { datasetConfiguration: { $set: action.initialState } });
    }

    case "INITIALIZE_SETTINGS": {
      return update(state, {
        datasetConfiguration: { $set: action.initialDatasetSettings },
        userConfiguration: { $set: action.initialUserSettings },
      });
    }

    case "SET_DATASET": {
      return update(state, {
        dataset: { $set: action.dataset },
        datasetConfiguration: { dataLayerNames: { $set: action.dataLayerNames } },
      });
    }

    case "RESET_LAYER_COLOR": {
  //       setDefaultBinaryColors(forceDefault = false) {
  //   let defaultColors;
  //   let layer;
  //   const layers = this.get("layers");

  //   if (this.dataLayerNames.length === 1) {
  //     defaultColors = [[255, 255, 255]];
  //   } else {
  //     defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
  //                       [255, 255, 0], [0, 255, 255], [255, 0, 255]];
  //   }

  //   this.dataLayerNames.forEach((layerName, i) => {
  //     const defaults = {
  //       color: defaultColors[i % defaultColors.length],
  //       brightness: 0,
  //       contrast: 1,
  //     };

  //     if (forceDefault || !layers[layerName]) {
  //       layer = defaults;
  //     } else {
  //       layer = _.defaults(layers[layerName], defaults);
  //     }

  //     this.set(`layers.${layerName}`, layer);
  //   });
  // }
    }
      break;
    default:
      return state;
  }
};

export default SettingsReducer;

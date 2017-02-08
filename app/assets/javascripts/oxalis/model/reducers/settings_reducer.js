/**
 * settings_reducer.js
 * @flow
 */

import update from "immutability-helper";
import type { SettingActionTypes } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";

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
      return update(state, { datasetConfiguration: { $merge: { layers: { [layerName]: { [propertyName]: value } } } } });
    }

    case "INITIALIZE_USER_SETTINGS": {
      return update(state, { userConfiguration: { $set: action.initialState } });
    }

    case "INITIALIZE_DATASET_SETTINGS": {
      return update(state, { datasetConfiguration: { $set: action.initialState } });
    }

    default:
      return state;
  }
};

export default SettingsReducer;

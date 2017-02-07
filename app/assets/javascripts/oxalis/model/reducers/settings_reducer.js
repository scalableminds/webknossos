/**
 * settings_reducer.js
 * @flow
 */

import type { SettingActionTypes } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";

const SettingsReducer = (state: OxalisState, action: SettingActionTypes) => {
  switch (action.type) {
    case "UPDATE_SETTING":
      return Object.assign({}, state, { [action.propertyName]: [action.value] });

    default:
      return state;
  }
};

export default SettingsReducer;

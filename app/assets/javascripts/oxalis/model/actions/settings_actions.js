/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */
import type { OxalisState } from "oxalis/store";

type UpdateSettingActionType = {type: string, propertyName: string, value: any};
type InitializeSettingsAction = {type: string, initialState: OxalisState};
export type SettingActionTypes = (UpdateSettingActionType | InitializeSettingsAction);

export const updateSettingAction = (propertyName: string, value: any): UpdateSettingActionType => ({
  type: "UPDATE_SETTING",
  propertyName,
  value,
});

export const initializeSettingsAction = (initialState: OxalisState): InitializeSettingsAction => ({
  type: "INITIALIZE_SETTINGS",
  initialState,
});


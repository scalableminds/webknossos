/* eslint-disable import/prefer-default-export */

/**
 * settings_actions.js
 * @flow
 */

type UpdateSettingActionType = {type: string, propertyName: string, value: any};
export type SettingActionTypes = UpdateSettingActionType;

export const updateSettingAction = (propertyName: string, value: any): UpdateSettingActionType => ({
  type: "UPDATE_SETTING",
  propertyName,
  value,
});

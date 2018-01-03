// @flow
/* eslint-disable import/prefer-default-export */
import type { APIUserType } from "admin/api_flow_types";

type SetActiveUserType = {
  type: "SET_ACTIVE_USER",
  user: APIUserType,
};

type LogoutUserType = {
  type: "LOGOUT_USER",
};

export type UserActionType = SetActiveUserType | LogoutUserType;

export const setActiveUserAction = (user: APIUserType): SetActiveUserType => ({
  type: "SET_ACTIVE_USER",
  user,
});

export const logoutUserAction = (): LogoutUserType => ({
  type: "LOGOUT_USER",
});

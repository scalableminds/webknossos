// @flow
/* eslint-disable import/prefer-default-export */
import type { APIUserType } from "admin/api_flow_types";

type SetActiveUserType = {
  type: "SET_ACTIVE_USER",
  user: APIUserType,
};

export type UserActionType = SetActiveUserType;

export const setActiveUserAction = (user: APIUserType): SetActiveUserType => ({
  type: "SET_ACTIVE_USER",
  user,
});

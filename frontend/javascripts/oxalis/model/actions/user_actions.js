// @flow
import type { APIUser } from "types/api_flow_types";

type SetActiveUser = {
  type: "SET_ACTIVE_USER",
  user: APIUser,
};

type LogoutUser = {
  type: "LOGOUT_USER",
};

export type UserAction = SetActiveUser | LogoutUser;

export const setActiveUserAction = (user: APIUser): SetActiveUser => ({
  type: "SET_ACTIVE_USER",
  user,
});

export const logoutUserAction = (): LogoutUser => ({
  type: "LOGOUT_USER",
});

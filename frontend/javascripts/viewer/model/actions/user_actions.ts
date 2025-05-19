import type { APIUser } from "types/api_types";

export type SetActiveUser = ReturnType<typeof setActiveUserAction>;
type LogoutUser = ReturnType<typeof logoutUserAction>;

export type UserAction = SetActiveUser | LogoutUser;

export const setActiveUserAction = (user: APIUser) =>
  ({
    type: "SET_ACTIVE_USER",
    user,
  }) as const;

export const logoutUserAction = () =>
  ({
    type: "LOGOUT_USER",
  }) as const;

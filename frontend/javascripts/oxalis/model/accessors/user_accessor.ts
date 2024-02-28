import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import type { APIUser, APIUserBase } from "types/api_flow_types";

export function enforceActiveUser(activeUser: APIUser | null | undefined): APIUser {
  if (activeUser) {
    return activeUser;
  } else {
    throw new Error(messages["auth.error_no_user"]);
  }
}

export function formatUserName(
  activeUser: APIUserBase | null | undefined,
  user: APIUserBase | undefined | null,
) {
  if (!user) {
    return "Unknown";
  }
  const maybeYouHint = activeUser?.id === user.id ? " (you)" : "";
  return `${user.firstName} ${user.lastName}${maybeYouHint}`;
}

const keyContributors = memoizeOne((contributors: APIUserBase[]) => _.keyBy(contributors, "id"));

export function getContributorById(
  userId: string | undefined,
  contributors: APIUserBase[],
): APIUserBase | null {
  if (!userId) {
    return null;
  }
  return keyContributors(contributors)[userId];
}

export default {};

// @flow

import messages from "messages";
import type { APIUserType } from "admin/api_flow_types";

export function getActiveUser(activeUser: ?APIUserType): APIUserType {
  if (activeUser) {
    return activeUser;
  } else {
    throw Error(messages["auth.error_no_user"]);
  }
}

export default {};

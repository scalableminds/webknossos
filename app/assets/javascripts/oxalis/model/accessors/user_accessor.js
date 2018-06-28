// @flow

import messages from "messages";
import type { APIUserType } from "admin/api_flow_types";

export function enforceActiveUser(activeUser: ?APIUserType): APIUserType {
  if (activeUser) {
    return activeUser;
  } else {
    throw new Error(messages["auth.error_no_user"]);
  }
}

export default {};

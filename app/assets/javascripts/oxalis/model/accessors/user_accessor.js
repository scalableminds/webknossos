// @flow

import messages from "messages";
import type { APIUser } from "admin/api_flow_types";

export function enforceActiveUser(activeUser: ?APIUser): APIUser {
  if (activeUser) {
    return activeUser;
  } else {
    throw new Error(messages["auth.error_no_user"]);
  }
}

export default {};

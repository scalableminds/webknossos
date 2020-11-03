// @flow

import type { APIUser } from "types/api_flow_types";
import messages from "messages";

export function enforceActiveUser(activeUser: ?APIUser): APIUser {
  if (activeUser) {
    return activeUser;
  } else {
    throw new Error(messages["auth.error_no_user"]);
  }
}

export default {};

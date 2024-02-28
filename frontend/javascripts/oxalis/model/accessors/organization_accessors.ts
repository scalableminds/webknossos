import messages from "messages";
import { APIOrganization } from "types/api_flow_types";

export function enforceActiveOrganization(
  activeOrganization: APIOrganization | null,
): APIOrganization {
  if (activeOrganization) {
    return activeOrganization;
  } else {
    throw new Error(messages["auth.error_no_organization"]);
  }
}

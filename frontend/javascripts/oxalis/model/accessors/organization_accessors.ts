import type { APIOrganization } from "types/api_flow_types";
import messages from "messages";

export function enforceActiveOrganization(
  activeOrganization: APIOrganization | null,
): APIOrganization {
  if (activeOrganization) {
    return activeOrganization;
  } else {
    throw new Error(messages["auth.error_no_organization"]);
  }
}

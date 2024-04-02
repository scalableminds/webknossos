import type { APIOrganization } from "types/api_flow_types";

type SetActiveOrganization = ReturnType<typeof setActiveOrganizationAction>;

export type OrganizationAction = SetActiveOrganization;

export const setActiveOrganizationAction = (organization: APIOrganization) =>
  ({
    type: "SET_ACTIVE_ORGANIZATION",
    organization,
  }) as const;

import type { APIOrganization } from "types/api_flow_types";

type SetActiveOrganization = ReturnType<typeof setActiveOrganizationAction>;
type SetActiveOrganizationsCreditBalance = ReturnType<typeof setActiveOrganizationsCreditBalance>;

export type OrganizationAction = SetActiveOrganization | SetActiveOrganizationsCreditBalance;

export const setActiveOrganizationAction = (organization: APIOrganization) =>
  ({
    type: "SET_ACTIVE_ORGANIZATION",
    organization,
  }) as const;

export const setActiveOrganizationsCreditBalance = (creditBalance: number) => {
  return {
    type: "SET_ACTIVE_ORGANIZATIONS_CREDIT_BALANCE",
    creditBalance,
  } as const;
};

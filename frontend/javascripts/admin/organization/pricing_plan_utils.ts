import { APIOrganization, APIUser } from "types/api_flow_types";
import { PricingPlanEnum } from "./organization_edit_view";

export const teamPlanFeatures = [
  "Collaborative Annotation",
  "Project Management",
  "Dataset Management and Access Control",
  "5 Users / 1TB Storage (upgradable)",
  "Priority Email Support",
  "Everything from Basic plan",
];
export const powerPlanFeatures = [
  "Unlimited Users",
  "Segmentation Proof-Reading Tool",
  "On-premise or dedicated hosting solutions available",
  "Integration with your HPC and storage servers",
  "Everything from Team and Basic plans",
];

export const maxInludedUsersInBasicPlan = 3;

export function getActiveUserCount(users: APIUser[]): number {
  return users.filter((user) => user.isActive && !user.isSuperUser).length;
}

export function hasPricingPlanExpired(organization: APIOrganization): boolean {
  return Date.now() > organization.paidUntil;
}

export function hasPricingPlanExceededUsers(
  organization: APIOrganization,
  activeUserCount: number,
): boolean {
  return activeUserCount > organization.includedUsers;
}

export function hasPricingPlanExceededStorage(organization: APIOrganization): boolean {
  return organization.usedStorageBytes > organization.includedStorageBytes;
}

export function isUserAllowedToRequestUpgrades(user: APIUser): boolean {
  return user.isAdmin || user.isOrganizationOwner;
}

const PLAN_TO_RANK = {
  [PricingPlanEnum.Basic]: 0,
  [PricingPlanEnum.Team]: 1,
  [PricingPlanEnum.TeamTrial]: 1,
  [PricingPlanEnum.Power]: 2,
  [PricingPlanEnum.PowerTrial]: 2,
  [PricingPlanEnum.Custom]: 2,
};

export function isPricingPlanGreaterEqualThan(
  planA: PricingPlanEnum,
  planB: PricingPlanEnum,
): boolean {
  return PLAN_TO_RANK[planA] >= PLAN_TO_RANK[planB];
}

import messages from "messages";
import type { APIOrganization, APIUser } from "types/api_types";

export enum PricingPlanEnum {
  Basic = "Basic",
  Team = "Team",
  Power = "Power",
  TeamTrial = "Team_Trial",
  PowerTrial = "Power_Trial",
  Custom = "Custom",
}

export const teamPlanFeatures = [
  "Everything from Basic plan",
  "Collaborative Annotation",
  "Project Management",
  "Dataset Management and Access Control",
  "5 Users / 1TB Storage (upgradable)",
  "Priority Email Support",
];

export const powerPlanFeatures = [
  "Everything from Team and Basic plans",
  "Unlimited Users",
  "Segmentation Proof-Reading Tool",
  "On-premise or dedicated hosting solutions available",
  "Integration with your HPC and storage servers",
];

export const maxInludedUsersInBasicPlan = 3;

export function getActiveUserCount(users: APIUser[]): number {
  return users.filter((user) => user.isActive && !user.isUnlisted && !user.isGuest).length;
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

export function getLeftOverStorageBytes(organization: APIOrganization): number {
  return organization.includedStorageBytes - organization.usedStorageBytes;
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

export function isFeatureAllowedByPricingPlan(
  organization: APIOrganization | null,
  requiredPricingPlan: PricingPlanEnum,
) {
  // This function should not be called to check for "Basic" plans since its the default plan for all users anyway.

  if (requiredPricingPlan === PricingPlanEnum.Basic) {
    console.debug(
      "Restricting a feature to Basic Plan does not make sense. Consider removing the restriction",
    );
    return true;
  }

  if (!organization) return false;

  return isPricingPlanGreaterEqualThan(organization.pricingPlan, requiredPricingPlan);
}

export function getFeatureNotAvailableInPlanMessage(
  requiredPricingPlan: PricingPlanEnum,
  organization: APIOrganization | null,
  activeUser: APIUser | null | undefined,
) {
  if (activeUser?.isOrganizationOwner) {
    return messages["organization.plan.feature_not_available.owner"](requiredPricingPlan);
  }

  let organizationOwnerName = "";
  // expected naming schema for owner: "(M. Mustermann)" | ""
  if (organization?.ownerName) {
    {
      const [firstName, ...rest] = organization.ownerName.split(" ");
      organizationOwnerName = `(${firstName[0]}. ${rest.join(" ")})`;
    }
  }

  return messages["organization.plan.feature_not_available"](
    requiredPricingPlan,
    organizationOwnerName,
  );
}

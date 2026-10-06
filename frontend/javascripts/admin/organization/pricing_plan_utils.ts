import messages from "messages";
import type { APIOrganization, APIUser } from "types/api_types";

export enum PricingPlanEnum {
  Personal = "Personal",
  Team = "Team",
  Power = "Power",
  TeamTrial = "Team_Trial",
  PowerTrial = "Power_Trial",
  OpenSource = "Open_Source",
  Enterprise = "Enterprise",
}

// Mirrors PricingPlan.label in app/models/organization/PricingPlan.scala
const PRICING_PLAN_LABELS: Partial<Record<PricingPlanEnum, string>> = {
  [PricingPlanEnum.TeamTrial]: "Team (Trial)",
  [PricingPlanEnum.PowerTrial]: "Power (Trial)",
  [PricingPlanEnum.OpenSource]: "Open-Source",
};

export function formatPricingPlanLabel(pricingPlan: PricingPlanEnum): string {
  return PRICING_PLAN_LABELS[pricingPlan] ?? pricingPlan;
}

// Open-Source behaves like Personal
export function isFreePlan(pricingPlan: PricingPlanEnum): boolean {
  return pricingPlan === PricingPlanEnum.Personal || pricingPlan === PricingPlanEnum.OpenSource;
}

export enum AiPlanEnum {
  TeamAI = "Team_AI",
  PowerAI = "Power_AI",
}

const AI_PLAN_LABELS: Record<AiPlanEnum, string> = {
  [AiPlanEnum.TeamAI]: "Team AI",
  [AiPlanEnum.PowerAI]: "Power AI",
};

export const teamPlanFeatures = [
  "Everything from Personal plan",
  "Collaborative Annotation",
  "Project Management",
  "Dataset Management and Access Control",
  "5 Users / 1TB Storage (upgradable)",
  "Eligible for the AI Add-on and AI model training",
  "Priority Email Support",
];

export const powerPlanFeatures = [
  "Everything from Team and Personal plans",
  "Up to Unlimited Users",
  "Segmentation Proof-Reading Tool",
  "On-premise or dedicated hosting solutions available",
  "Integration with your HPC and storage servers",
  "Eligible for the AI Add-on and AI model training",
];

export const aiAddonFeatures = [
  "Train custom AI models on your data",
  "Seamless access to WEBKNOSSOS GPU compute infrastructure",
  "Includes WEBKNOSSOS credits (400 Team / 1,000 Power)",
  "Enable AI model training for your team",
  "Priority access to AI job queue",
];

export const maxIncludedUsersInPersonalPlan = 1;

export function getActiveUserCount(users: APIUser[]): number {
  return users.filter((user) => user.isActive && !user.isUnlisted && !user.isGuest).length;
}

export function hasPricingPlanExpired(organization: APIOrganization): boolean {
  return Date.now() > organization.paidUntil;
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

// Mirrors PricingPlan.tierRank in app/models/organization/PricingPlan.scala
const PLAN_TO_RANK: Record<PricingPlanEnum, number> = {
  [PricingPlanEnum.Personal]: 0,
  [PricingPlanEnum.OpenSource]: 0,
  [PricingPlanEnum.Team]: 1,
  [PricingPlanEnum.TeamTrial]: 1,
  [PricingPlanEnum.Power]: 2,
  [PricingPlanEnum.PowerTrial]: 2,
  [PricingPlanEnum.Enterprise]: 2,
};

function isPricingPlanGreaterEqualThan(planA: PricingPlanEnum, planB: PricingPlanEnum): boolean {
  return PLAN_TO_RANK[planA] >= PLAN_TO_RANK[planB];
}

export function isFeatureAllowedByPricingPlan(
  organization: APIOrganization | null,
  requiredPricingPlan: PricingPlanEnum,
) {
  // This function should not be called to check for "Personal" plans since its the default plan for all users anyway.

  if (requiredPricingPlan === PricingPlanEnum.Personal) {
    console.debug(
      "Restricting a feature to Personal Plan does not make sense. Consider removing the restriction",
    );
    return true;
  }

  if (!organization) return false;

  return isPricingPlanGreaterEqualThan(organization.pricingPlan, requiredPricingPlan);
}

export function hasSomePaidPlan(organization: APIOrganization | null) {
  return isFeatureAllowedByPricingPlan(organization, PricingPlanEnum.Team);
}

export function hasAiPlan(organization: APIOrganization | null) {
  return organization?.aiPlan != null;
}

export function isAiAddonEligiblePlan(pricingPlan: PricingPlanEnum): boolean {
  return !isFreePlan(pricingPlan);
}

export function formatAiPlanLabel(organization: APIOrganization): string {
  if (!isAiAddonEligiblePlan(organization.pricingPlan))
    return "Upgrade to Team or Power plan for advanced AI features";

  if (organization.aiPlan) return AI_PLAN_LABELS[organization.aiPlan] ?? organization.aiPlan;

  return "No AI add-on";
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

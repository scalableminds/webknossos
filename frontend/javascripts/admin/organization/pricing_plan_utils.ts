import dayjs from "dayjs";
import { formatCountToDataAmountUnit, formatNumber } from "libs/format_utils";
import messages from "messages";
import type { APIOrganization, APIUser } from "types/api_types";
import Constants from "viewer/constants";

export enum PricingPlanEnum {
  Personal = "Personal",
  Team = "Team",
  Power = "Power",
  TeamTrial = "Team_Trial",
  PowerTrial = "Power_Trial",
  Custom = "Custom",
}

export enum AiPlanEnum {
  TeamAI = "Team_AI",
  PowerAI = "Power_AI",
}

const AI_PLAN_LABELS: Record<AiPlanEnum, string> = {
  [AiPlanEnum.TeamAI]: "Team AI",
  [AiPlanEnum.PowerAI]: "Power AI",
};

export const PRICING_PAGE_URL = "https://webknossos.org/pricing";

export const teamPlanIncludedUsers = 5;
export const teamPlanIncludedStorageTB = 1;

export const teamPlanFeatures = [
  "Everything from Personal plan",
  "Collaborative Annotation",
  "Project Management",
  "Dataset Management and Access Control",
  `${teamPlanIncludedUsers} Users / ${teamPlanIncludedStorageTB}TB Storage (upgradable)`,
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

// Paid plans are highlighted as expiring once they are this close to their end date.
export const PLAN_EXPIRATION_REMINDER_DAYS = 30;

// Below this many credits, the balance is shown as low.
const LOW_CREDIT_BALANCE = 10;

export function formatPricingPlanName(pricingPlan: PricingPlanEnum): string {
  return pricingPlan.replaceAll("_", " ");
}

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

// The backend only accepts credit orders from the organization owner.
export function isUserAllowedToOrderCredits(user: APIUser): boolean {
  return user.isOrganizationOwner;
}

// Renaming and deleting the organization, its notification settings and the activity logs are
// restricted to admins by the backend.
export function isUserAllowedToManageOrganization(user: APIUser): boolean {
  return user.isAdmin;
}

export function isCreditBalanceLow(milliCreditBalance: number | null | undefined): boolean {
  return milliCreditBalance != null && milliCreditBalance < LOW_CREDIT_BALANCE * 1000;
}

export const PLAN_TO_RANK: Record<PricingPlanEnum, number> = {
  [PricingPlanEnum.Personal]: 0,
  [PricingPlanEnum.Team]: 1,
  [PricingPlanEnum.TeamTrial]: 1,
  [PricingPlanEnum.Power]: 2,
  [PricingPlanEnum.PowerTrial]: 2,
  [PricingPlanEnum.Custom]: 2,
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

export function formatIncludedUsers(includedUsers: number): string {
  return Number.isFinite(includedUsers) ? formatNumber(includedUsers) : "∞";
}

export function formatIncludedStorage(includedStorageBytes: number): string {
  return Number.isFinite(includedStorageBytes)
    ? formatCountToDataAmountUnit(includedStorageBytes, true)
    : "∞";
}

export function isTrialPlan(pricingPlan: PricingPlanEnum): boolean {
  return pricingPlan === PricingPlanEnum.TeamTrial || pricingPlan === PricingPlanEnum.PowerTrial;
}

// Maps trial plans to the plan they are a trial of, e.g. "Power_Trial" -> "Power".
export function getBasePricingPlan(pricingPlan: PricingPlanEnum): PricingPlanEnum {
  if (pricingPlan === PricingPlanEnum.TeamTrial) return PricingPlanEnum.Team;
  if (pricingPlan === PricingPlanEnum.PowerTrial) return PricingPlanEnum.Power;
  return pricingPlan;
}

export function canUpgradePricingPlan(pricingPlan: PricingPlanEnum): boolean {
  return !isPricingPlanGreaterEqualThan(pricingPlan, PricingPlanEnum.Power);
}

export function hasPlanEndDate(organization: APIOrganization): boolean {
  return organization.paidUntil !== Constants.MAXIMUM_DATE_TIMESTAMP;
}

// Personal plans and plans without an end date can't be extended.
export function canExtendPricingPlan(organization: APIOrganization): boolean {
  return organization.pricingPlan !== PricingPlanEnum.Personal && hasPlanEndDate(organization);
}

// Returns null for plans without an expiration date.
export function getDaysUntilPlanExpires(organization: APIOrganization): number | null {
  if (!hasPlanEndDate(organization)) return null;
  return Math.max(0, Math.ceil(dayjs(organization.paidUntil).diff(dayjs(), "day", true)));
}

// Expired plans are not "about to expire", see hasPricingPlanExpired.
export function isPlanAboutToExpire(organization: APIOrganization): boolean {
  const daysLeft = getDaysUntilPlanExpires(organization);
  return (
    daysLeft != null &&
    daysLeft <= PLAN_EXPIRATION_REMINDER_DAYS &&
    !hasPricingPlanExpired(organization)
  );
}

export function getAiAddonIncludedCredits(pricingPlan: PricingPlanEnum): number {
  return isPricingPlanGreaterEqualThan(pricingPlan, PricingPlanEnum.Power) ? 1000 : 400;
}

export function isAiAddonEligiblePlan(pricingPlan: PricingPlanEnum): boolean {
  return (
    pricingPlan === PricingPlanEnum.Team ||
    pricingPlan === PricingPlanEnum.TeamTrial ||
    pricingPlan === PricingPlanEnum.Power ||
    pricingPlan === PricingPlanEnum.PowerTrial ||
    pricingPlan === PricingPlanEnum.Custom
  );
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

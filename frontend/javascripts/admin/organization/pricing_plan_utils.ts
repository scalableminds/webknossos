import dayjs from "dayjs";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import messages from "messages";
import type { APIDataStore, APIJobCommand, APIOrganization, APIUser } from "types/api_types";
import Constants from "viewer/constants";

// See https://home.webknossos.org/pricing for the features of each plan.
// Mirrors app/models/organization/PricingPlan.scala
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

// Open-Source has no access to WEBKNOSSOS workers, so it can run no jobs (including AI analysis and animations).
// Mirrors PricingPlan.allowsJobs
export function areJobsAllowedByPricingPlan(organization: APIOrganization | null): boolean {
  return organization?.pricingPlan !== PricingPlanEnum.OpenSource;
}

export function isJobAvailable(
  dataStore: APIDataStore,
  jobCommand: APIJobCommand,
  organization: APIOrganization | null,
): boolean {
  return (
    areJobsAllowedByPricingPlan(organization) &&
    dataStore.jobsSupportedByAvailableWorkers.includes(jobCommand)
  );
}

// Mirrors PricingPlan.allowsAiQuickSelect
export function isAiQuickSelectAllowedByPricingPlan(organization: APIOrganization | null): boolean {
  return organization?.pricingPlan !== PricingPlanEnum.OpenSource;
}

export enum AiPlanEnum {
  TeamAI = "Team_AI",
  PowerAI = "Power_AI",
}

const AI_PLAN_LABELS: Record<AiPlanEnum, string> = {
  [AiPlanEnum.TeamAI]: "Team AI",
  [AiPlanEnum.PowerAI]: "Power AI",
};

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

// Open-Source unlocks the collaboration features of Team, Enterprise the features of Power. The features that
// Open-Source lacks are checked separately, see areJobsAllowedByPricingPlan and isAiQuickSelectAllowedByPricingPlan.
// Mirrors PricingPlan.tierRank in app/models/organization/PricingPlan.scala
export const PLAN_TO_RANK: Record<PricingPlanEnum, number> = {
  [PricingPlanEnum.Personal]: 0,
  [PricingPlanEnum.Team]: 1,
  [PricingPlanEnum.TeamTrial]: 1,
  [PricingPlanEnum.OpenSource]: 1,
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

export function formatIncludedUsers(includedUsers: number): string {
  return Number.isFinite(includedUsers) ? includedUsers.toString() : "∞";
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

// Returns null for plans without an expiration date.
export function getDaysUntilPlanExpires(organization: APIOrganization): number | null {
  if (organization.paidUntil === Constants.MAXIMUM_DATE_TIMESTAMP) return null;
  return Math.max(0, Math.ceil(dayjs(organization.paidUntil).diff(dayjs(), "day", true)));
}

export function getAiAddonIncludedCredits(pricingPlan: PricingPlanEnum): number {
  return isPricingPlanGreaterEqualThan(pricingPlan, PricingPlanEnum.Power) ? 1000 : 400;
}

export function isAiAddonEligiblePlan(pricingPlan: PricingPlanEnum): boolean {
  return pricingPlan !== PricingPlanEnum.Personal && pricingPlan !== PricingPlanEnum.OpenSource;
}

export function formatAiPlanLabel(organization: APIOrganization): string {
  if (organization.pricingPlan === PricingPlanEnum.OpenSource)
    return "AI features are not available in the Open-Source plan";
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

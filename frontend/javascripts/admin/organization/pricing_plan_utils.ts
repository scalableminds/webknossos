import dayjs from "dayjs";
import { formatCountToDataAmountUnit, formatNumber } from "libs/format_utils";
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
  [PricingPlanEnum.OpenSource]: "Open Source",
};

// Open Source has no access to WEBKNOSSOS workers, so it can run no jobs (including AI analysis and animations).
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

export const PRICING_PAGE_URL = "https://webknossos.org/pricing";
export const SALES_MAILTO_URL =
  "mailto:sales@webknossos.org?subject=Upgrading%20our%20self-hosted%20WEBKNOSSOS";

// Upgrade requests are sent with the mail settings of the instance, which self-hosted instances often lack, and
// sales can't change the plan of a self-hosted organization anyway. So self-hosted Open Source organizations contact
// sales directly instead. Enterprise is already the highest plan and isn't offered any plan upgrades.
export function shouldContactSalesForUpgrades(
  organization: APIOrganization | null,
  isWkorgInstance: boolean,
): boolean {
  return !isWkorgInstance && organization?.pricingPlan === PricingPlanEnum.OpenSource;
}

export function contactSales() {
  window.location.href = SALES_MAILTO_URL;
}

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
// Matches the six weeks after which the backend reports the plan as almost exceeded.
export const PLAN_EXPIRATION_REMINDER_DAYS = 6 * 7;

// Below this many credits, the balance is shown as low.
const LOW_CREDIT_BALANCE = 10;

export function formatPricingPlanName(pricingPlan: PricingPlanEnum): string {
  return PRICING_PLAN_LABELS[pricingPlan] ?? pricingPlan;
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

// Open Source unlocks the collaboration features of Team, Enterprise the features of Power. The features that
// Open Source lacks are checked separately, see areJobsAllowedByPricingPlan and isAiQuickSelectAllowedByPricingPlan.
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
  return Number.isFinite(includedUsers) ? formatNumber(includedUsers) : "∞";
}

// Keeps round amounts in their natural unit ("100 GB", not "0.1 TB") without a trailing ".0".
// Rounds down, so usage just below a limit doesn't read as the limit ("1.96 TB" → "1.9 TB").
export function formatStorage(bytes: number): string {
  if (!Number.isFinite(bytes)) return "∞";
  const unitFactor = bytes >= 1000 ? 1000 ** Math.min(4, Math.floor(Math.log10(bytes) / 3)) : 1;
  // One decimal in the target unit. Plain bytes are formatted without decimals anyway.
  const step = unitFactor >= 1000 ? unitFactor / 10 : 1;
  const roundedDownBytes = Math.floor(bytes / step) * step;
  return formatCountToDataAmountUnit(roundedDownBytes).replace(/\.0(?=\D)/, "");
}

export function isTrialPlan(pricingPlan: PricingPlanEnum): boolean {
  return pricingPlan === PricingPlanEnum.TeamTrial || pricingPlan === PricingPlanEnum.PowerTrial;
}

// Shown before the end date. Trials aren't paid for, so they "end" instead.
export function getPlanEndLabel(organization: APIOrganization): string {
  const hasExpired = hasPricingPlanExpired(organization);
  if (isTrialPlan(organization.pricingPlan)) return hasExpired ? "ended on" : "ends on";
  return hasExpired ? "expired on" : "paid until";
}

// Maps trial plans to the plan they are a trial of, e.g. "Power_Trial" -> "Power".
export function getBasePricingPlan(pricingPlan: PricingPlanEnum): PricingPlanEnum {
  if (pricingPlan === PricingPlanEnum.TeamTrial) return PricingPlanEnum.Team;
  if (pricingPlan === PricingPlanEnum.PowerTrial) return PricingPlanEnum.Power;
  return pricingPlan;
}

// Personal has to upgrade the plan instead, and Open Source and Enterprise come with unlimited quotas.
export function canBuyQuotaUpgrades(pricingPlan: PricingPlanEnum): boolean {
  const basePlan = getBasePricingPlan(pricingPlan);
  return basePlan === PricingPlanEnum.Team || basePlan === PricingPlanEnum.Power;
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
  return pricingPlan !== PricingPlanEnum.Personal && pricingPlan !== PricingPlanEnum.OpenSource;
}

export function formatAiPlanLabel(organization: APIOrganization): string {
  if (organization.pricingPlan === PricingPlanEnum.OpenSource)
    return "AI features are not available in the Open Source plan";
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

import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { formatCountToDataAmountUnit, formatNumber } from "libs/format_utils";
import type { APIOrganization } from "types/api_types";
import Constants from "viewer/constants";
import {
  areJobsAllowedByPricingPlan,
  hasAiPlan,
  PLAN_TO_RANK,
  PricingPlanEnum,
  teamPlanIncludedStorageTB,
  teamPlanIncludedUsers,
} from "../pricing_plan_utils";

export type ItemId = "plan" | "users" | "storage" | "aiAddon" | "credits" | "extend";

// Trials, Open-Source and Enterprise are mapped to the plan whose features they unlock, see getPlanTier.
export type PlanTier = PricingPlanEnum.Personal | PricingPlanEnum.Team | PricingPlanEnum.Power;

export type ItemSelection = { value?: number; custom?: boolean };
export type Selection = Partial<Record<ItemId, ItemSelection>>;

type Amount = { label: string; value: number };

export type ItemDef = {
  id: ItemId;
  label: string;
  hint: string;
  amounts?: Amount[];
  allowCustom?: boolean;
  minPlan: PlanTier;
  getDelta: (value: number | undefined) => { from: string; to: string };
};

const BYTES_PER_TB = 1e12;
const DATE_FORMAT = "D MMM YYYY";

export function getPlanTier(pricingPlan: PricingPlanEnum): PlanTier {
  switch (pricingPlan) {
    case PricingPlanEnum.Personal:
      return PricingPlanEnum.Personal;
    case PricingPlanEnum.Team:
    case PricingPlanEnum.TeamTrial:
    case PricingPlanEnum.OpenSource:
      return PricingPlanEnum.Team;
    case PricingPlanEnum.Power:
    case PricingPlanEnum.PowerTrial:
    case PricingPlanEnum.Enterprise:
      return PricingPlanEnum.Power;
  }
}

// The plans that sales can be asked for.
export type UpgradeTargetTier = PricingPlanEnum.Team | PricingPlanEnum.Power;
const UPGRADE_TARGET_TIERS: UpgradeTargetTier[] = [PricingPlanEnum.Team, PricingPlanEnum.Power];

// The plans that can be requested from the current one. The first one is the default.
export function getUpgradeTargetTiers(currentTier: PlanTier): UpgradeTargetTier[] {
  return UPGRADE_TARGET_TIERS.filter((tier) => PLAN_TO_RANK[tier] > PLAN_TO_RANK[currentTier]);
}

export function getUpgradeTargetTier(currentTier: PlanTier): UpgradeTargetTier | null {
  return getUpgradeTargetTiers(currentTier)[0] ?? null;
}

// The value of the plan selection is the rank of the requested plan. It is only set when
// there is more than one plan to choose from.
export function getRequestedTier(
  currentTier: PlanTier,
  selection: Selection,
): UpgradeTargetTier | null {
  if (selection.plan == null) return null;
  const { value } = selection.plan;
  if (value == null) return getUpgradeTargetTier(currentTier);
  return UPGRADE_TARGET_TIERS.find((tier) => PLAN_TO_RANK[tier] === value) ?? null;
}

export function getTierRank(tier: PlanTier): number {
  return PLAN_TO_RANK[tier];
}

export function isTierAtLeast(tier: PlanTier, minTier: PlanTier): boolean {
  return PLAN_TO_RANK[tier] >= PLAN_TO_RANK[minTier];
}

export function getEffectiveTier(currentTier: PlanTier, selection: Selection): PlanTier {
  return getRequestedTier(currentTier, selection) ?? currentTier;
}

export function formatUserCount(count: number): string {
  return count === Number.POSITIVE_INFINITY ? "∞" : formatNumber(count);
}

export function formatStorage(bytes: number): string {
  return bytes === Number.POSITIVE_INFINITY ? "∞" : formatCountToDataAmountUnit(bytes, true);
}

export function getCreditBalance(organization: APIOrganization): number {
  return Math.floor((organization.milliCreditBalance ?? 0) / 1000);
}

// Plans without an end date can't be extended.
export function hasPlanEndDate(organization: APIOrganization): boolean {
  return organization.paidUntil !== Constants.MAXIMUM_DATE_TIMESTAMP;
}

export function formatPaidUntil(organization: APIOrganization): string {
  return formatDateInLocalTimeZone(organization.paidUntil, DATE_FORMAT);
}

/*
 * Returns the items that the organization may request, in display order.
 * Items that need a higher plan than the effective one are still returned, they are shown locked.
 */
export function getUpgradeItems(
  organization: APIOrganization,
  // Only the organization owner may order credits.
  canOrderCredits: boolean,
): ItemDef[] {
  const currentTier = getPlanTier(organization.pricingPlan);
  const targetTiers = getUpgradeTargetTiers(currentTier);
  const isPersonal = currentTier === PricingPlanEnum.Personal;

  // On Personal, all quota upgrades are based on what the Team plan includes.
  const baseUsers = isPersonal ? teamPlanIncludedUsers : organization.includedUsers;
  const baseStorageBytes = isPersonal
    ? teamPlanIncludedStorageTB * BYTES_PER_TB
    : organization.includedStorageBytes;
  const creditBalance = getCreditBalance(organization);

  let plan: ItemDef | null = null;
  if (targetTiers.length === 1) {
    const [targetTier] = targetTiers;
    plan = {
      id: "plan",
      label: `Upgrade to ${targetTier} plan`,
      hint: `${currentTier} → ${targetTier}`,
      minPlan: PricingPlanEnum.Personal,
      getDelta: () => ({ from: currentTier, to: targetTier }),
    };
  } else if (targetTiers.length > 1) {
    plan = {
      id: "plan",
      label: "Upgrade plan",
      hint: `${currentTier} → ${targetTiers.join(" or ")}`,
      amounts: targetTiers.map((tier) => ({ label: tier, value: PLAN_TO_RANK[tier] })),
      minPlan: PricingPlanEnum.Personal,
      getDelta: (value) => ({
        from: currentTier,
        to: UPGRADE_TARGET_TIERS.find((tier) => PLAN_TO_RANK[tier] === value) ?? targetTiers[0],
      }),
    };
  }

  const users: ItemDef = {
    id: "users",
    label: isPersonal ? "Extra user seats" : "User seats",
    hint: isPersonal ? `Team includes ${teamPlanIncludedUsers}` : formatUserCount(baseUsers),
    amounts: (isPersonal ? [1, 3, 5] : [1, 5, 10]).map((value) => ({ label: `+${value}`, value })),
    allowCustom: true,
    minPlan: PricingPlanEnum.Team,
    getDelta: (value = 0) => ({
      from: formatUserCount(baseUsers),
      to: formatUserCount(baseUsers + value),
    }),
  };

  const storage: ItemDef = {
    id: "storage",
    label: isPersonal ? "Extra storage" : "Storage",
    hint: isPersonal
      ? `Team includes ${teamPlanIncludedStorageTB} TB`
      : formatStorage(baseStorageBytes),
    amounts: [1, 5, 10].map((value) => ({ label: `+${value} TB`, value })),
    allowCustom: true,
    minPlan: PricingPlanEnum.Team,
    getDelta: (value = 0) => ({
      from: formatStorage(baseStorageBytes),
      to: formatStorage(baseStorageBytes + value * BYTES_PER_TB),
    }),
  };

  // Open-Source organizations have no access to WEBKNOSSOS workers, so they can't use AI features.
  const canUseAi = areJobsAllowedByPricingPlan(organization);

  const aiAddon: ItemDef | null =
    hasAiPlan(organization) || !canUseAi
      ? null
      : {
          id: "aiAddon",
          label: "AI Add-on",
          hint: "Not active",
          minPlan: PricingPlanEnum.Team,
          getDelta: () => ({ from: "Not active", to: "Active" }),
        };

  const credits: ItemDef | null =
    !canOrderCredits || !canUseAi
      ? null
      : {
          id: "credits",
          label: "AI credits",
          hint: isPersonal ? "For AI jobs" : `${formatNumber(creditBalance)} left`,
          amounts: [1000, 5000, 10000].map((value) => ({
            label: `+${formatNumber(value)}`,
            value,
          })),
          allowCustom: true,
          minPlan: PricingPlanEnum.Team,
          getDelta: (value = 0) => ({
            from: formatNumber(creditBalance),
            to: formatNumber(creditBalance + value),
          }),
        };

  const extend: ItemDef | null =
    isPersonal || !hasPlanEndDate(organization)
      ? null
      : {
          id: "extend",
          label: "Extend plan",
          hint: `Ends ${formatPaidUntil(organization)}`,
          amounts: [
            { label: "1 year", value: 1 },
            { label: "2 years", value: 2 },
          ],
          minPlan: PricingPlanEnum.Team,
          getDelta: (value = 1) => ({
            from: formatPaidUntil(organization),
            to: formatDateInLocalTimeZone(
              dayjs(organization.paidUntil).add(value, "year").valueOf(),
              DATE_FORMAT,
            ),
          }),
        };

  const orderedItems = isPersonal
    ? [plan, users, storage, aiAddon, credits]
    : [credits, users, storage, aiAddon, plan, extend];
  return orderedItems.filter((item): item is ItemDef => item != null);
}

export function getDefaultSelection(item: ItemDef): ItemSelection {
  return item.amounts != null ? { value: item.amounts[0].value } : {};
}

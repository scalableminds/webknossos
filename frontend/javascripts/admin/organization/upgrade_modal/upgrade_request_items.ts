import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { formatCountToDataAmountUnit, formatNumber } from "libs/format_utils";
import type { APIOrganization } from "types/api_types";
import Constants from "viewer/constants";
import {
  hasAiPlan,
  PricingPlanEnum,
  teamPlanIncludedStorageTB,
  teamPlanIncludedUsers,
} from "../pricing_plan_utils";

export type ItemId = "plan" | "users" | "storage" | "aiAddon" | "credits" | "extend";

export type PlanTier = "Personal" | "Team" | "Power";

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
  delta: (value: number | undefined) => { from: string; to: string };
};

const TIER_RANK: Record<PlanTier, number> = { Personal: 0, Team: 1, Power: 2 };
const BYTES_PER_TB = 1e12;
const DATE_FORMAT = "D MMM YYYY";

export function getPlanTier(pricingPlan: PricingPlanEnum): PlanTier {
  switch (pricingPlan) {
    case PricingPlanEnum.Personal:
      return "Personal";
    case PricingPlanEnum.Team:
    case PricingPlanEnum.TeamTrial:
      return "Team";
    default:
      return "Power";
  }
}

export function getUpgradeTargetTier(currentTier: PlanTier): PlanTier | null {
  if (currentTier === "Personal") return "Team";
  if (currentTier === "Team") return "Power";
  return null;
}

export function isTierAtLeast(tier: PlanTier, minTier: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minTier];
}

export function getEffectiveTier(currentTier: PlanTier, selection: Selection): PlanTier {
  const targetTier = getUpgradeTargetTier(currentTier);
  return selection.plan != null && targetTier != null ? targetTier : currentTier;
}

function formatUserCount(count: number): string {
  return count === Number.POSITIVE_INFINITY ? "∞" : formatNumber(count);
}

function formatStorage(bytes: number): string {
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
export function getUpgradeItems(organization: APIOrganization): ItemDef[] {
  const currentTier = getPlanTier(organization.pricingPlan);
  const targetTier = getUpgradeTargetTier(currentTier);
  const isPersonal = currentTier === "Personal";

  // On Personal, all quota upgrades are based on what the Team plan includes.
  const baseUsers = isPersonal ? teamPlanIncludedUsers : organization.includedUsers;
  const baseStorageBytes = isPersonal
    ? teamPlanIncludedStorageTB * BYTES_PER_TB
    : organization.includedStorageBytes;
  const creditBalance = getCreditBalance(organization);

  const plan: ItemDef | null =
    targetTier != null
      ? {
          id: "plan",
          label: `Upgrade to ${targetTier} plan`,
          hint: `${currentTier} → ${targetTier}`,
          minPlan: "Personal",
          delta: () => ({ from: currentTier, to: targetTier }),
        }
      : null;

  const users: ItemDef = {
    id: "users",
    label: isPersonal ? "Extra user seats" : "User seats",
    hint: isPersonal ? `Team includes ${teamPlanIncludedUsers}` : formatUserCount(baseUsers),
    amounts: (isPersonal ? [1, 3, 5] : [1, 5, 10]).map((value) => ({ label: `+${value}`, value })),
    allowCustom: true,
    minPlan: "Team",
    delta: (value = 0) => ({
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
    minPlan: "Team",
    delta: (value = 0) => ({
      from: formatStorage(baseStorageBytes),
      to: formatStorage(baseStorageBytes + value * BYTES_PER_TB),
    }),
  };

  const aiAddon: ItemDef | null = hasAiPlan(organization)
    ? null
    : {
        id: "aiAddon",
        label: "AI Add-on",
        hint: "Not active",
        minPlan: "Team",
        delta: () => ({ from: "Not active", to: "Active" }),
      };

  const credits: ItemDef = {
    id: "credits",
    label: "AI credits",
    hint: isPersonal ? "For AI jobs" : `${formatNumber(creditBalance)} left`,
    amounts: [1000, 5000, 10000].map((value) => ({ label: `+${formatNumber(value)}`, value })),
    allowCustom: true,
    minPlan: "Team",
    delta: (value = 0) => ({
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
          minPlan: "Team",
          delta: (value = 1) => ({
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

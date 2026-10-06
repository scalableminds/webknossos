import renderIndependently from "libs/render_independently";
import type { PricingPlanEnum } from "./pricing_plan_utils";
import { getPlanTier, type ItemId, type PlanTier } from "./upgrade_modal/upgrade_request_items";
import UpgradeRequestModal from "./upgrade_modal/upgrade_request_modal";

// All upgrade requests share one modal. Each entry point only differs in the item it preselects.
function openUpgradeRequestModal(initialItems: ItemId[], initialPlan?: PlanTier) {
  renderIndependently((destroyCallback) => (
    <UpgradeRequestModal
      initialItems={initialItems}
      initialPlan={initialPlan}
      destroy={destroyCallback}
    />
  ));
}

function extendPricingPlan() {
  openUpgradeRequestModal(["extend"]);
}

function upgradeUserQuota() {
  openUpgradeRequestModal(["users"]);
}

function upgradeStorageQuota() {
  openUpgradeRequestModal(["storage"]);
}

export function requestAiPlanUpgrade() {
  openUpgradeRequestModal(["aiAddon"]);
}

// Without a target plan, the next higher plan is preselected.
function upgradePricingPlan(targetPlan?: PricingPlanEnum.Team | PricingPlanEnum.Power) {
  openUpgradeRequestModal(["plan"], targetPlan != null ? getPlanTier(targetPlan) : undefined);
}

function orderWebknossosCredits() {
  openUpgradeRequestModal(["credits"]);
}

export default {
  upgradePricingPlan,
  extendPricingPlan,
  upgradeUserQuota,
  upgradeStorageQuota,
  requestAiPlanUpgrade,
  orderWebknossosCredits,
};

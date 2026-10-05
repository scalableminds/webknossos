import renderIndependently from "libs/render_independently";
import type { ItemId } from "./upgrade_modal/upgrade_request_items";
import UpgradeRequestModal from "./upgrade_modal/upgrade_request_modal";

// All upgrade requests share one modal. Each entry point only differs in the item it preselects.
function openUpgradeRequestModal(initialItems: ItemId[]) {
  renderIndependently((destroyCallback) => (
    <UpgradeRequestModal initialItems={initialItems} destroy={destroyCallback} />
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

function upgradePricingPlan() {
  openUpgradeRequestModal(["plan"]);
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

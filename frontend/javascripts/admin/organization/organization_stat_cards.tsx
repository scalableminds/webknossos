import {
  BankOutlined,
  CrownOutlined,
  DatabaseOutlined,
  DollarCircleOutlined,
  LockOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { SettingsCard, StatSuffix } from "admin/account/helpers/settings_card";
import { Button, Typography, theme } from "antd";
import { formatMilliCreditsString, formatNumber } from "libs/format_utils";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import type React from "react";
import { ColorWKGold } from "theme";
import type { APIOrganization } from "types/api_types";
import {
  useActiveOrganization,
  useCanManageOrganization,
  useCanOrderCredits,
  useCanRequestUpgrades,
  useUpdateActiveOrganization,
} from "./organization_hooks";
import {
  canBuyQuotaUpgrades,
  formatAiPlanLabel,
  formatIncludedUsers,
  formatPricingPlanName,
  formatStorage,
  getAiAddonIncludedCredits,
  isAiAddonEligiblePlan,
  isCreditBalanceLow,
  PRICING_PAGE_URL,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\-_. ß]+$/;
const UPGRADE_TO_TEAM_HINT = "Upgrade to Team for more";

type Quota = "users" | "storage";

// Returns undefined for unlimited quotas, which have no meter.
function getFillLevel(used: number, limit: number): number | undefined {
  return Number.isFinite(limit) && limit > 0 ? used / limit : undefined;
}

function getUsersHint(organization: APIOrganization, activeUsersCount: number): string | undefined {
  if (!Number.isFinite(organization.includedUsers)) return undefined;
  const seatsLeft = organization.includedUsers - activeUsersCount;
  if (seatsLeft < 0) return `${-seatsLeft} ${pluralize("user", -seatsLeft)} over the limit`;
  if (organization.pricingPlan === PricingPlanEnum.Personal) return UPGRADE_TO_TEAM_HINT;
  return seatsLeft > 0 ? `${seatsLeft} ${pluralize("seat", seatsLeft)} left` : "No seats left";
}

function getStorageHint(organization: APIOrganization): string | undefined {
  const { usedStorageBytes, includedStorageBytes } = organization;
  if (!Number.isFinite(includedStorageBytes)) return undefined;
  const overLimitBytes = usedStorageBytes - includedStorageBytes;
  if (overLimitBytes > 0) return `${formatStorage(overLimitBytes)} over the limit`;
  if (organization.pricingPlan === PricingPlanEnum.Personal) return UPGRADE_TO_TEAM_HINT;
  const fillLevel = getFillLevel(usedStorageBytes, includedStorageBytes);
  // Rounds down like formatStorage, so storage just below the limit doesn't read as "100% used".
  return fillLevel != null ? `${Math.floor(fillLevel * 100)}% used` : undefined;
}

// Personal can only upgrade the plan. Unlimited quotas need no top-up.
function getQuotaUpgradeAction(
  organization: APIOrganization,
  quota: Quota,
  canRequestUpgrades: boolean,
): React.ReactNode {
  if (!canRequestUpgrades) return null;
  if (organization.pricingPlan === PricingPlanEnum.Personal) {
    return (
      <Button
        type="primary"
        icon={<CrownOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Team)}
      >
        Upgrade to Team
      </Button>
    );
  }
  const limit = quota === "users" ? organization.includedUsers : organization.includedStorageBytes;
  if (!canBuyQuotaUpgrades(organization.pricingPlan) || !Number.isFinite(limit)) return null;
  return quota === "users" ? (
    <Button
      type="primary"
      icon={<UserAddOutlined />}
      onClick={() => UpgradePricingPlanModal.upgradeUserQuota()}
    >
      Add users
    </Button>
  ) : (
    <Button
      type="primary"
      icon={<PlusOutlined />}
      onClick={() => UpgradePricingPlanModal.upgradeStorageQuota()}
    >
      Add storage
    </Button>
  );
}

export function OrganizationNameCard() {
  const organization = useActiveOrganization();
  const canManageOrganization = useCanManageOrganization();
  const updateActiveOrganization = useUpdateActiveOrganization();

  async function setOrganizationName(newOrgaName: string) {
    if (!ORGA_NAME_REGEX_PATTERN.test(newOrgaName)) {
      Toast.error(
        "Organization name can only contain letters, numbers, spaces, and the following special characters: - _ . ß",
      );
      return;
    }
    await updateActiveOrganization({ name: newOrgaName });
  }

  return (
    <SettingsCard
      size="stat"
      title="Name"
      icon={<BankOutlined />}
      content={
        <Typography.Text
          editable={canManageOrganization ? { onChange: setOrganizationName } : false}
          style={{ fontSize: "inherit", fontWeight: "inherit" }}
        >
          {organization.name}
        </Typography.Text>
      }
    />
  );
}

export function OrganizationOwnerCard() {
  const organization = useActiveOrganization();
  return (
    <SettingsCard
      size="stat"
      title="Owner"
      icon={<UserOutlined />}
      content={organization.ownerName}
    />
  );
}

export function PricingPlanCard() {
  const organization = useActiveOrganization();
  return (
    <SettingsCard
      size="stat"
      title="Current Plan"
      icon={<CrownOutlined />}
      content={formatPricingPlanName(organization.pricingPlan)}
      tooltip={
        <a href={PRICING_PAGE_URL} target="_blank" rel="noopener noreferrer">
          Compare all plans
        </a>
      }
    />
  );
}

export function UsersQuotaCard({ activeUsersCount }: { activeUsersCount: number }) {
  const organization = useActiveOrganization();
  const canRequestUpgrades = useCanRequestUpgrades();
  return (
    <SettingsCard
      size="stat"
      title="Users"
      icon={<TeamOutlined />}
      content={
        <>
          {activeUsersCount}
          <StatSuffix>/ {formatIncludedUsers(organization.includedUsers)}</StatSuffix>
        </>
      }
      meter={getFillLevel(activeUsersCount, organization.includedUsers)}
      hint={getUsersHint(organization, activeUsersCount)}
      footerAction={getQuotaUpgradeAction(organization, "users", canRequestUpgrades)}
    />
  );
}

export function StorageQuotaCard() {
  const organization = useActiveOrganization();
  const canRequestUpgrades = useCanRequestUpgrades();
  return (
    <SettingsCard
      size="stat"
      title="Storage"
      icon={<DatabaseOutlined />}
      content={
        <>
          {formatStorage(organization.usedStorageBytes)}
          <StatSuffix>/ {formatStorage(organization.includedStorageBytes)}</StatSuffix>
        </>
      }
      meter={getFillLevel(organization.usedStorageBytes, organization.includedStorageBytes)}
      hint={getStorageHint(organization)}
      footerAction={getQuotaUpgradeAction(organization, "storage", canRequestUpgrades)}
    />
  );
}

export function CreditBalanceCard() {
  const { milliCreditBalance } = useActiveOrganization();
  const canOrderCredits = useCanOrderCredits();
  const isBalanceLow = isCreditBalanceLow(milliCreditBalance);
  return (
    <SettingsCard
      size="stat"
      title="AI Credits"
      icon={<DollarCircleOutlined style={{ color: ColorWKGold }} />}
      content={
        milliCreditBalance != null ? (
          <>
            {formatMilliCreditsString(milliCreditBalance)}
            <StatSuffix>credits</StatSuffix>
          </>
        ) : (
          "N/A"
        )
      }
      hint={isBalanceLow ? "Low balance" : "Pays for AI jobs like segmentation"}
      hintType={isBalanceLow ? "warning" : "secondary"}
      footerAction={
        canOrderCredits ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => UpgradePricingPlanModal.orderWebknossosCredits()}
          >
            Buy credits
          </Button>
        ) : null
      }
    />
  );
}

export function AiAddonCard() {
  const organization = useActiveOrganization();
  const canRequestUpgrades = useCanRequestUpgrades();
  const { token } = theme.useToken();

  if (!isAiAddonEligiblePlan(organization.pricingPlan)) {
    return (
      <SettingsCard
        size="stat"
        title="AI Add-on"
        icon={<LockOutlined style={{ color: token.colorTextDisabled }} />}
        content="Not available"
        hint="Requires the Team or Power plan"
        style={{ background: token.colorFillQuaternary }}
      />
    );
  }

  if (organization.aiPlan != null) {
    return (
      <SettingsCard
        size="stat"
        title="AI Add-on"
        icon={<RobotOutlined />}
        content={formatAiPlanLabel(organization)}
        hint="Model training is enabled"
      />
    );
  }

  const includedCredits = formatNumber(getAiAddonIncludedCredits(organization.pricingPlan));
  return (
    <SettingsCard
      size="stat"
      title="AI Add-on"
      icon={<RobotOutlined style={{ color: token.colorTextDisabled }} />}
      content="Not active"
      hint={`Model training + ${includedCredits} credits`}
      footerAction={
        canRequestUpgrades ? (
          <Button
            type="primary"
            icon={<PlusCircleOutlined />}
            onClick={() => UpgradePricingPlanModal.requestAiPlanUpgrade()}
          >
            Get AI Add-on
          </Button>
        ) : null
      }
    />
  );
}

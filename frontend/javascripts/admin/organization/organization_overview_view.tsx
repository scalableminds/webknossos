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
import { useQuery } from "@tanstack/react-query";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus } from "admin/api/organization";
import { Button, Col, Row, Space, Spin, Typography, theme } from "antd";
import { formatCountToDataAmountUnit, formatMilliCreditsString } from "libs/format_utils";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { type Key, useEffect } from "react";
import { ColorWKGold } from "theme";
import { SettingsCard, type SettingsCardProps, StatSuffix } from "../account/helpers/settings_card";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
} from "./organization_cards";
import {
  useActiveOrganization,
  useCanManageOrganization,
  useCanOrderCredits,
  useCanRequestUpgrades,
  useOrganizationUsers,
  useUpdateActiveOrganization,
} from "./organization_hooks";
import { UpgradeOfferCards } from "./plan_upgrade_cards";
import {
  formatAiPlanLabel,
  formatIncludedUsers,
  formatPricingPlanName,
  getActiveUserCount,
  getAiAddonIncludedCredits,
  isAiAddonEligiblePlan,
  isCreditBalanceLow,
  PRICING_PAGE_URL,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\-_. ß]+$/;

// Keeps round amounts in their natural unit ("100 GB", not "0.1 TB") and drops a trailing ".0".
function formatStorage(bytes: number): string {
  return formatCountToDataAmountUnit(bytes).replace(/\.0(?=\D)/, "");
}

type StatCardProps = SettingsCardProps & { key: Key };

export function OrganizationOverviewView() {
  const organization = useActiveOrganization();
  const updateActiveOrganization = useUpdateActiveOrganization();
  const canManageOrganization = useCanManageOrganization();
  const canOrderCredits = useCanOrderCredits();
  const { token } = theme.useToken();

  const { data: users = [], isFetching: isFetchingUsers } = useOrganizationUsers();

  const {
    data: pricingPlanStatus,
    isFetching: isFetchingPlanStatus,
    error: pricingPlanError,
  } = useQuery({
    queryKey: ["pricingPlanStatus"],
    queryFn: getPricingPlanStatus,
  });

  useEffect(() => {
    if (pricingPlanError) {
      Toast.error("Could not load pricing plan status.");
      console.error(pricingPlanError);
    }
  }, [pricingPlanError]);

  const isFetchingData = isFetchingUsers || isFetchingPlanStatus;
  const activeUsersCount = getActiveUserCount(users);

  async function setOrganizationName(newOrgaName: string) {
    if (!ORGA_NAME_REGEX_PATTERN.test(newOrgaName)) {
      Toast.error(
        "Organization name can only contain letters, numbers, spaces, and the following special characters: - _ . ß",
      );
      return;
    }

    await updateActiveOrganization({ name: newOrgaName });
  }

  const isPersonal = organization.pricingPlan === PricingPlanEnum.Personal;
  const isTeamOrTeamTrial =
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial;
  // Personal has to upgrade the plan instead, and Custom limits are negotiated individually.
  const canBuyMoreUsersAndStorage =
    isTeamOrTeamTrial ||
    organization.pricingPlan === PricingPlanEnum.Power ||
    organization.pricingPlan === PricingPlanEnum.PowerTrial;
  const hasUserLimit = organization.includedUsers !== Number.POSITIVE_INFINITY;
  const hasStorageLimit = organization.includedStorageBytes !== Number.POSITIVE_INFINITY;
  const canRequestUpgrades = useCanRequestUpgrades();
  const isEligibleForAiAddon = isAiAddonEligiblePlan(organization.pricingPlan);

  const usersMeter = hasUserLimit ? activeUsersCount / organization.includedUsers : undefined;
  const usersStat: StatCardProps = {
    key: "users",
    title: "Users",
    icon: <TeamOutlined />,
    content: (
      <>
        {activeUsersCount}
        <StatSuffix>/ {formatIncludedUsers(organization.includedUsers)}</StatSuffix>
      </>
    ),
    meter: usersMeter,
  };
  const usersOverLimit = hasUserLimit ? activeUsersCount - organization.includedUsers : 0;
  if (usersOverLimit > 0) {
    usersStat.hint = `${usersOverLimit} ${pluralize("user", usersOverLimit)} over the limit`;
  } else if (isPersonal) {
    usersStat.hint = "Upgrade to Team for more";
  }
  if (isPersonal && canRequestUpgrades) {
    usersStat.footerAction = (
      <Button
        type="primary"
        icon={<CrownOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Team)}
      >
        Upgrade to Team
      </Button>
    );
  } else if (hasUserLimit && usersOverLimit <= 0) {
    const seatsLeft = -usersOverLimit;
    usersStat.hint =
      seatsLeft > 0 ? `${seatsLeft} ${pluralize("seat", seatsLeft)} left` : "No seats left";
  }
  // Unlimited quotas need no top-up.
  if (canBuyMoreUsersAndStorage && canRequestUpgrades && hasUserLimit) {
    usersStat.footerAction = (
      <Button
        type="primary"
        icon={<UserAddOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradeUserQuota()}
      >
        Add users
      </Button>
    );
  }

  const storageMeter =
    hasStorageLimit && organization.includedStorageBytes > 0
      ? organization.usedStorageBytes / organization.includedStorageBytes
      : undefined;
  const storageStat: StatCardProps = {
    key: "storage",
    title: "Storage",
    icon: <DatabaseOutlined />,
    content: (
      <>
        {formatStorage(organization.usedStorageBytes)}
        <StatSuffix>
          / {hasStorageLimit ? formatStorage(organization.includedStorageBytes) : "∞"}
        </StatSuffix>
      </>
    ),
    meter: storageMeter,
  };
  const storageOverLimit = hasStorageLimit
    ? organization.usedStorageBytes - organization.includedStorageBytes
    : 0;
  if (storageOverLimit > 0) {
    storageStat.hint = `${formatStorage(storageOverLimit)} over the limit`;
  } else if (isPersonal) {
    storageStat.hint = "Upgrade to Team for more";
  } else if (storageMeter != null) {
    storageStat.hint = `${Math.round(storageMeter * 100)}% used`;
  }
  if (isPersonal && canRequestUpgrades) {
    storageStat.footerAction = (
      <Button
        type="primary"
        icon={<CrownOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Team)}
      >
        Upgrade to Team
      </Button>
    );
  }
  if (canBuyMoreUsersAndStorage && canRequestUpgrades && hasStorageLimit) {
    storageStat.footerAction = (
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradeStorageQuota()}
      >
        Add storage
      </Button>
    );
  }

  const creditBalance = organization.milliCreditBalance;
  const isBalanceLow = isCreditBalanceLow(creditBalance);
  const creditsStat: StatCardProps = {
    key: "credits",
    title: "AI Credits",
    icon: <DollarCircleOutlined style={{ color: ColorWKGold }} />,
    content:
      creditBalance != null ? (
        <>
          {formatMilliCreditsString(creditBalance)}
          <StatSuffix>credits</StatSuffix>
        </>
      ) : (
        "N/A"
      ),
    hint: isBalanceLow ? "Low balance" : "Pays for AI jobs like segmentation",
    hintType: isBalanceLow ? "warning" : "secondary",
    footerAction: canOrderCredits ? (
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => UpgradePricingPlanModal.orderWebknossosCredits()}
      >
        Buy credits
      </Button>
    ) : null,
  };

  let aiAddonStat: StatCardProps;
  if (!isEligibleForAiAddon) {
    aiAddonStat = {
      key: "ai-plan",
      title: "AI Add-on",
      icon: <LockOutlined style={{ color: token.colorTextDisabled }} />,
      content: "Not available",
      hint: "Requires the Team or Power plan",
      style: { background: token.colorFillQuaternary },
    };
  } else if (organization.aiPlan == null) {
    const includedCredits = getAiAddonIncludedCredits(organization.pricingPlan).toLocaleString(
      "en-US",
    );
    aiAddonStat = {
      key: "ai-plan",
      title: "AI Add-on",
      icon: <RobotOutlined style={{ color: token.colorTextDisabled }} />,
      content: "Not active",
      hint: `Model training + ${includedCredits} credits`,
      footerAction: canRequestUpgrades ? (
        <Button
          type="primary"
          icon={<PlusCircleOutlined />}
          onClick={() => UpgradePricingPlanModal.requestAiPlanUpgrade()}
        >
          Get AI Add-on
        </Button>
      ) : null,
    };
  } else {
    aiAddonStat = {
      key: "ai-plan",
      title: "AI Add-on",
      icon: <RobotOutlined />,
      content: formatAiPlanLabel(organization),
      hint: "Model training is enabled",
    };
  }

  const rowOneStats: StatCardProps[] = [
    {
      key: "name",
      title: "Name",
      icon: <BankOutlined />,
      content: (
        <Typography.Text
          editable={canManageOrganization ? { onChange: setOrganizationName } : false}
          style={{ fontSize: "inherit", fontWeight: "inherit" }}
        >
          {organization.name}
        </Typography.Text>
      ),
    },
    {
      key: "owner",
      title: "Owner",
      icon: <UserOutlined />,
      content: organization.ownerName,
    },
    {
      key: "plan",
      title: "Current Plan",
      icon: <CrownOutlined />,
      content: formatPricingPlanName(organization.pricingPlan),
      tooltip: (
        <a href={PRICING_PAGE_URL} target="_blank" rel="noopener noreferrer">
          Compare all plans
        </a>
      ),
    },
  ];
  const rowTwoStats: StatCardProps[] = [usersStat, storageStat, creditsStat, aiAddonStat];

  return (
    <>
      <SettingsTitle title={organization.name} description="Manage your organization." />
      {pricingPlanStatus?.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus?.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Spin spinning={isFetchingData}>
          <Space orientation="vertical" size={24} style={{ width: "100%" }}>
            <Row gutter={[24, 24]}>
              {rowOneStats.map(({ key, ...stat }) => (
                <Col span={8} key={key}>
                  <SettingsCard size="stat" {...stat} />
                </Col>
              ))}
            </Row>
            <Row gutter={[24, 24]}>
              {rowTwoStats.map(({ key, ...stat }) => (
                <Col span={6} key={key}>
                  <SettingsCard size="stat" {...stat} />
                </Col>
              ))}
            </Row>
            <PlanExpirationCard organization={organization} />
          </Space>
        </Spin>
        <UpgradeOfferCards organization={organization} />
      </Space>
    </>
  );
}

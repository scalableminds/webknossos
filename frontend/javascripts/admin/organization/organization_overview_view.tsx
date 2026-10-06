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
import { getPricingPlanStatus, updateOrganization } from "admin/api/organization";
import { getUsers } from "admin/rest_api";
import { Button, Col, Row, Space, Spin, Tag, Typography, theme } from "antd";
import { formatCountToDataAmountUnit, formatMilliCreditsString } from "libs/format_utils";
import { useApi, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { type Key, useEffect } from "react";
import { useDispatch } from "react-redux";
import { ColorWKGold } from "theme";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import {
  isMeterWarning,
  SettingsCard,
  type SettingsCardProps,
  StatSuffix,
} from "../account/helpers/settings_card";
import {
  AiAddonUpgradeCard,
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { PowerPlanUpgradeCard } from "./plan_upgrade_cards";
import {
  formatAiPlanLabel,
  getActiveUserCount,
  isAiAddonEligiblePlan,
  isUserAllowedToRequestUpgrades,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\-_. ß]+$/;
// Below this many credits, the balance is shown as low.
const LOW_CREDIT_BALANCE = 10;

type StatCardProps = SettingsCardProps & { key: Key };

export function OrganizationOverviewView() {
  const dispatch = useDispatch();
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const activeUser = useWkSelector((state) => state.activeUser);
  const { token } = theme.useToken();

  const {
    data: users = [],
    isFetching: isFetchingUsers,
    error: usersError,
  } = useApi({
    queryKey: ["users"],
    queryFn: () => getUsers(),
  });

  const {
    data: pricingPlanStatus,
    isFetching: isFetchingPlanStatus,
    error: pricingPlanError,
  } = useQuery({
    queryKey: ["pricingPlanStatus"],
    queryFn: getPricingPlanStatus,
  });

  useEffect(() => {
    if (usersError) {
      Toast.error("Could not load users.");
      console.error(usersError);
    }
  }, [usersError]);

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

    const updatedOrganization = await updateOrganization(
      organization.id,
      newOrgaName,
      organization.newUserMailingList,
    );
    dispatch(setActiveOrganizationAction(updatedOrganization));
  }

  const isPersonal = organization.pricingPlan === PricingPlanEnum.Personal;
  const isTeamOrTeamTrial =
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial;
  const hasUserLimit = organization.includedUsers !== Number.POSITIVE_INFINITY;
  const hasStorageLimit = organization.includedStorageBytes !== Number.POSITIVE_INFINITY;
  const canRequestAiPlan = activeUser ? isUserAllowedToRequestUpgrades(activeUser) : false;
  const isEligibleForAiAddon = isAiAddonEligiblePlan(organization.pricingPlan);
  const showAiAddonCard = organization.aiPlan == null && isEligibleForAiAddon;

  const usersMeter = hasUserLimit ? activeUsersCount / organization.includedUsers : undefined;
  const usersStat: StatCardProps = {
    key: "users",
    title: "Users",
    icon: <TeamOutlined />,
    size: "stat",
    content: (
      <>
        {activeUsersCount}
        <StatSuffix>/ {hasUserLimit ? organization.includedUsers : "∞"}</StatSuffix>
      </>
    ),
    meter: usersMeter,
  };
  if (isPersonal) {
    usersStat.hint = `Personal is limited to ${organization.includedUsers} ${pluralize("user", organization.includedUsers)}`;
    usersStat.footerAction = (
      <Button
        type="primary"
        icon={<UserAddOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
      >
        Invite your team
      </Button>
    );
  } else if (hasUserLimit) {
    const seatsLeft = Math.max(organization.includedUsers - activeUsersCount, 0);
    usersStat.hint =
      seatsLeft > 0 ? `${seatsLeft} ${pluralize("seat", seatsLeft)} left` : "No seats left";
  }
  if (isTeamOrTeamTrial) {
    usersStat.footerAction = (
      <Button
        type={isMeterWarning(usersMeter) ? "primary" : "default"}
        icon={<UserAddOutlined />}
        onClick={UpgradePricingPlanModal.upgradeUserQuota}
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
    size: "stat",
    content: (
      <>
        {formatCountToDataAmountUnit(organization.usedStorageBytes, true)}
        <StatSuffix>
          /{" "}
          {hasStorageLimit
            ? formatCountToDataAmountUnit(organization.includedStorageBytes, true)
            : "∞"}
        </StatSuffix>
      </>
    ),
    meter: storageMeter,
  };
  if (isPersonal) {
    storageStat.hint = "Team includes 1 TB";
    storageStat.footerAction = (
      <Button
        icon={<PlusOutlined />}
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
      >
        Get more storage
      </Button>
    );
  } else if (storageMeter != null) {
    storageStat.hint = `${Math.round(storageMeter * 100)}% used`;
  }
  if (isTeamOrTeamTrial) {
    storageStat.footerAction = (
      <Button
        type={isMeterWarning(storageMeter) ? "primary" : "default"}
        icon={<PlusOutlined />}
        onClick={UpgradePricingPlanModal.upgradeStorageQuota}
      >
        Add storage
      </Button>
    );
  }

  const creditBalance = organization.milliCreditBalance;
  const isCreditBalanceLow = creditBalance != null && creditBalance < LOW_CREDIT_BALANCE * 1000;
  const creditsStat: StatCardProps = {
    key: "credits",
    title: "AI Credits",
    icon: <DollarCircleOutlined style={{ color: ColorWKGold }} />,
    size: "stat",
    content:
      creditBalance != null ? (
        <>
          {formatMilliCreditsString(creditBalance)}
          <StatSuffix>credits</StatSuffix>
        </>
      ) : (
        "N/A"
      ),
    hint: isCreditBalanceLow ? "Low balance" : "Pays for AI jobs like segmentation",
    hintType: isCreditBalanceLow ? "warning" : "secondary",
    footerAction: (
      <Button
        type={isCreditBalanceLow ? "primary" : "default"}
        icon={<PlusOutlined />}
        onClick={UpgradePricingPlanModal.orderWebknossosCredits}
      >
        Buy credits
      </Button>
    ),
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
    const includedCredits = isTeamOrTeamTrial ? "400" : "1,000";
    aiAddonStat = {
      key: "ai-plan",
      title: "AI Add-on",
      icon: <RobotOutlined style={{ color: token.colorTextDisabled }} />,
      content: "Not active",
      hint: `Model training + ${includedCredits} credits`,
      footerAction: canRequestAiPlan ? (
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
          editable={{
            onChange: setOrganizationName,
          }}
          style={{ fontWeight: "inherit" }}
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
  ];
  const rowTwoStats: StatCardProps[] = [usersStat, storageStat, creditsStat, aiAddonStat];

  function renderUpgradeCards() {
    if (!isPersonal && !isTeamOrTeamTrial && !showAiAddonCard) {
      return null;
    }

    let upgradeContent: React.ReactNode = null;

    if (isPersonal) {
      upgradeContent = <PlanUpgradeCard organization={organization} />;
    } else if (isTeamOrTeamTrial) {
      upgradeContent = (
        <Row gutter={24} style={{ marginTop: 24 }}>
          <Col span={showAiAddonCard ? 12 : 24}>
            <PowerPlanUpgradeCard
              description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
              powerUpgradeCallback={() =>
                UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Power)
              }
            />
          </Col>
          {showAiAddonCard && (
            <Col span={12}>
              <AiAddonUpgradeCard />
            </Col>
          )}
        </Row>
      );
    } else if (showAiAddonCard) {
      upgradeContent = (
        <Row gutter={24} style={{ marginTop: 24 }}>
          <Col span={24}>
            <AiAddonUpgradeCard />
          </Col>
        </Row>
      );
    }

    return (
      <div>
        <SettingsTitle
          title="Unlock more features"
          description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
        />
        {upgradeContent}
      </div>
    );
  }

  return (
    <>
      <SettingsTitle
        title={organization.name}
        description="Manage your organization."
        tag={
          <Tag icon={isPersonal ? undefined : <CrownOutlined />}>
            {organization.pricingPlan.replace("_", " ")}
          </Tag>
        }
      />
      {pricingPlanStatus?.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus?.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <Space orientation="vertical" size="large">
        <Spin spinning={isFetchingData}>
          <Space orientation="vertical" size={24}>
            <Row gutter={[24, 24]}>
              {rowOneStats.map(({ key, ...stat }) => (
                <Col span={12} key={key}>
                  <SettingsCard {...stat} />
                </Col>
              ))}
            </Row>
            <Row gutter={[24, 24]}>
              {rowTwoStats.map(({ key, ...stat }) => (
                <Col span={6} key={key}>
                  <SettingsCard {...stat} />
                </Col>
              ))}
            </Row>
            <PlanExpirationCard organization={organization} />
          </Space>
        </Spin>
        {renderUpgradeCards()}
      </Space>
    </>
  );
}

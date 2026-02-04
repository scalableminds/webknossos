import { PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus, updateOrganization } from "admin/api/organization";
import { getUsers } from "admin/rest_api";
import { Button, Col, Row, Spin, Typography } from "antd";
import { formatCountToDataAmountUnit, formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type Key, useEffect } from "react";
import { useDispatch } from "react-redux";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { SettingsCard, type SettingsCardProps } from "../account/helpers/settings_card";
import {
  AiAddonUpgradeCard,
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
  PowerPlanUpgradeCard,
} from "./organization_cards";
import {
  formatAiPlanLabel,
  getActiveUserCount,
  isAiAddonEligiblePlan,
  isUserAllowedToRequestUpgrades,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\-_. ß]+$/;

export function OrganizationOverviewView() {
  const dispatch = useDispatch();
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const activeUser = useWkSelector((state) => state.activeUser);

  const {
    data: users = [],
    isFetching: isFetchingUsers,
    error: usersError,
  } = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
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

  const maxUsersCountLabel =
    organization.includedUsers === Number.POSITIVE_INFINITY ? "∞" : organization.includedUsers;

  const includedStorageLabel =
    organization.includedStorageBytes === Number.POSITIVE_INFINITY
      ? "∞"
      : formatCountToDataAmountUnit(organization.includedStorageBytes, true);

  const usedStorageLabel = formatCountToDataAmountUnit(organization.usedStorageBytes, true);
  const aiPlanLabel = formatAiPlanLabel(organization.aiPlan);
  const canRequestAiPlan = activeUser ? isUserAllowedToRequestUpgrades(activeUser) : false;
  const isEligibleForAiAddon = isAiAddonEligiblePlan(organization.pricingPlan);
  const showAiAddonCard = organization.aiPlan == null && isEligibleForAiAddon;

  let upgradeUsersAction: React.ReactNode = null;
  let upgradeStorageAction: React.ReactNode = null;
  let upgradeAiPlanAction: React.ReactNode = null;

  if (
    organization.pricingPlan === PricingPlanEnum.Personal ||
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    upgradeUsersAction = (
      <Button
        shape="circle"
        type="primary"
        size="small"
        key="upgradeUsersAction"
        icon={<PlusOutlined />}
        onClick={
          organization.pricingPlan === PricingPlanEnum.Personal
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
            : UpgradePricingPlanModal.upgradeUserQuota
        }
      />
    );

    upgradeStorageAction = (
      <Button
        shape="circle"
        type="primary"
        size="small"
        key="upgradeStorageAction"
        icon={<PlusOutlined />}
        onClick={
          organization.pricingPlan === PricingPlanEnum.Personal
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
            : UpgradePricingPlanModal.upgradeStorageQuota
        }
      />
    );
  }
  const buyMoreCreditsAction = (
    <Button
      type="primary"
      shape="circle"
      icon={<PlusOutlined />}
      size="small"
      key="buyMoreCreditsAction"
      onClick={UpgradePricingPlanModal.orderWebknossosCredits}
    />
  );

  if (canRequestAiPlan && showAiAddonCard) {
    upgradeAiPlanAction = (
      <Button
        shape="circle"
        type="primary"
        size="small"
        key="upgradeAiPlanAction"
        icon={<PlusOutlined />}
        onClick={() => UpgradePricingPlanModal.requestAiPlanUpgrade(organization)}
      />
    );
  }

  const rowOneStats: (SettingsCardProps & { key: Key })[] = [
    {
      key: "name",
      title: "Name",
      content: (
        <Typography.Text
          editable={{
            onChange: setOrganizationName,
          }}
        >
          {organization.name}
        </Typography.Text>
      ),
    },
    {
      key: "owner",
      title: "Owner",
      content: organization.ownerName,
    },
  ];
  const rowTwoStats: (SettingsCardProps & { key: Key })[] = [
    {
      key: "plan",
      title: "Current Plan",
      content: organization.pricingPlan,
      tooltip: (
        <a href="https://webknossos.org/pricing" target="_blank" rel="noopener noreferrer">
          Compare all plans
        </a>
      ),
    },
    {
      key: "users",
      title: "Users",
      content: `${activeUsersCount} / ${maxUsersCountLabel}`,
      action: upgradeUsersAction,
    },
    {
      key: "storage",
      title: "Storage",
      content: `${usedStorageLabel} / ${includedStorageLabel}`,
      action: upgradeStorageAction,
    },
    {
      key: "ai-plan",
      title: "AI Add-on",
      content: aiPlanLabel,
      action: upgradeAiPlanAction,
    },
    {
      key: "credits",
      title: "AI Credits",
      content:
        organization.milliCreditBalance != null
          ? formatMilliCreditsString(organization.milliCreditBalance)
          : "N/A",
      action: buyMoreCreditsAction,
    },
  ];

  return (
    <>
      <SettingsTitle title={organization.name} description="Manage your organization." />
      {pricingPlanStatus?.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus?.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <Spin spinning={isFetchingData}>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          {rowOneStats.map((stat) => (
            <Col span={12} key={stat.key}>
              <SettingsCard
                title={stat.title}
                content={stat.content}
                action={stat.action}
                tooltip={stat.tooltip}
              />
            </Col>
          ))}
        </Row>
        <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
          {rowTwoStats.map((stat) => (
            <Col span={8} key={stat.key}>
              <SettingsCard
                title={stat.title}
                content={stat.content}
                action={stat.action}
                tooltip={stat.tooltip}
              />
            </Col>
          ))}
        </Row>
        
      </Spin>
      <PlanExpirationCard organization={organization} />
      {organization.pricingPlan === PricingPlanEnum.Personal ||
      organization.pricingPlan === PricingPlanEnum.Team ||
      organization.pricingPlan === PricingPlanEnum.TeamTrial ||
      showAiAddonCard ? (
        <>
          <SettingsTitle
            title="Unlock more features"
            description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
          />
          {organization.pricingPlan === PricingPlanEnum.Personal ? (
            <PlanUpgradeCard organization={organization} />
          ) : null}
          {organization.pricingPlan === PricingPlanEnum.Team ||
          organization.pricingPlan === PricingPlanEnum.TeamTrial ? (
            <Row gutter={24} style={{ marginTop: 24 }}>
              <Col span={showAiAddonCard ? 12 : 24}>
                <PowerPlanUpgradeCard
                  description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
                  powerUpgradeCallback={() =>
                    UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Power)
                  }
                />
              </Col>
              {showAiAddonCard ? (
                <Col span={12}>
                  <AiAddonUpgradeCard
                    description="Add AI model training capabilities to your organization."
                    onRequestUpgrade={
                      canRequestAiPlan
                        ? () => UpgradePricingPlanModal.requestAiPlanUpgrade(organization)
                        : undefined
                    }
                  />
                </Col>
              ) : null}
            </Row>
          ) : null}
          {organization.pricingPlan !== PricingPlanEnum.Personal &&
          organization.pricingPlan !== PricingPlanEnum.Team &&
          organization.pricingPlan !== PricingPlanEnum.TeamTrial &&
          showAiAddonCard ? (
            <Row gutter={24} style={{ marginTop: 24 }}>
              <Col span={24}>
                <AiAddonUpgradeCard
                  description="Add AI model training capabilities to your organization."
                  onRequestUpgrade={
                    canRequestAiPlan
                      ? () => UpgradePricingPlanModal.requestAiPlanUpgrade(organization)
                      : undefined
                  }
                />
              </Col>
            </Row>
          ) : null}
        </>
      ) : null}
    </>
  );
}

import { PlusOutlined } from "@ant-design/icons";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus, getUsers, updateOrganization } from "admin/rest_api";
import { Button, Col, Row, Spin, Tooltip, Typography } from "antd";
import { formatCountToDataAmountUnit, formatCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type Key, useEffect, useState } from "react";
import type { APIPricingPlanStatus } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { Store } from "viewer/singletons";
import { SettingsCard, type SettingsCardProps } from "../account/helpers/settings_card";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { PricingPlanEnum, getActiveUserCount } from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\-_. ß]+$/;

export function OrganizationOverviewView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [activeUsersCount, setActiveUsersCount] = useState(1);
  const [pricingPlanStatus, setPricingPlanStatus] = useState<APIPricingPlanStatus | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const [users, pricingPlanStatus] = await Promise.all([getUsers(), getPricingPlanStatus()]);

    setPricingPlanStatus(pricingPlanStatus);
    setActiveUsersCount(getActiveUserCount(users));
    setIsFetchingData(false);
  }

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
    Store.dispatch(setActiveOrganizationAction(updatedOrganization));
  }

  const maxUsersCountLabel =
    organization.includedUsers === Number.POSITIVE_INFINITY ? "∞" : organization.includedUsers;

  const includedStorageLabel =
    organization.includedStorageBytes === Number.POSITIVE_INFINITY
      ? "∞"
      : formatCountToDataAmountUnit(organization.includedStorageBytes, true);

  const usedStorageLabel = formatCountToDataAmountUnit(organization.usedStorageBytes, true);

  let upgradeUsersAction: React.ReactNode = null;
  let upgradeStorageAction: React.ReactNode = null;

  if (
    organization.pricingPlan === PricingPlanEnum.Basic ||
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    upgradeUsersAction = (
      <Button
        shape="circle"
        size="small"
        key="upgradeUsersAction"
        icon={<PlusOutlined />}
        onClick={
          organization.pricingPlan === PricingPlanEnum.Basic
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
            : UpgradePricingPlanModal.upgradeUserQuota
        }
      />
    );

    upgradeStorageAction = (
      <Button
        shape="circle"
        size="small"
        key="upgradeStorageAction"
        icon={<PlusOutlined />}
        onClick={
          organization.pricingPlan === PricingPlanEnum.Basic
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
            : UpgradePricingPlanModal.upgradeStorageQuota
        }
      />
    );
  }
  const buyMoreCreditsAction = (
    <Tooltip title="Disabled during testing phase" key="buyMoreCreditsAction">
      <Button
        type="default"
        shape="circle"
        icon={<PlusOutlined />}
        size="small"
        key="buyMoreCreditsAction"
        onClick={UpgradePricingPlanModal.orderWebknossosCredits}
        disabled
      />
    </Tooltip>
  );

  const orgaStats: (SettingsCardProps & { key: Key })[] = [
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
      key: "credits",
      title: "WEBKNOSSOS Credits",
      content:
        organization.creditBalance != null
          ? formatCreditsString(organization.creditBalance)
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
          {orgaStats.map((stat) => (
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
      {organization.pricingPlan === PricingPlanEnum.Basic ||
      organization.pricingPlan === PricingPlanEnum.Team ||
      organization.pricingPlan === PricingPlanEnum.TeamTrial ? (
        <>
          <SettingsTitle
            title="Unlock more features"
            description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
          />
          <PlanUpgradeCard organization={organization} />
        </>
      ) : null}
    </>
  );
}

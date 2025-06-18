import { PlusOutlined } from "@ant-design/icons";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus, getUsers, updateOrganization } from "admin/rest_api";
import { Button, Col, Row, Spin, Tooltip, Typography } from "antd";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import type { APIOrganization, APIPricingPlanStatus } from "types/api_types";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { Store } from "viewer/singletons";
import { SettingsCard } from "../account/helpers/settings_card";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { PricingPlanEnum, getActiveUserCount } from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const ORGA_NAME_REGEX_PATTERN = /^[A-Za-z0-9\\-_\\. ß]+$/;

export function OrganizationOverviewView({ organization }: { organization: APIOrganization }) {
  const [isFetchingData, setIsFetchingData] = useState(false);
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
  let upgradePlanAction: React.ReactNode = null;

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

    upgradePlanAction = (
      <Button
        shape="circle"
        size="small"
        key="comparePlanAction"
        icon={<PlusOutlined />}
        href="https://webknossos.org/pricing"
        target="_blank"
        rel="noopener noreferrer"
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

  const orgaStats = [
    {
      key: "name",
      title: "Name",
      value: (
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
      value: organization.ownerName,
    },
    {
      key: "plan",
      title: "Current Plan",
      value: organization.pricingPlan,
      action: upgradePlanAction,
    },
    {
      key: "users",
      title: "Users",
      value: `${activeUsersCount} / ${maxUsersCountLabel}`,
      action: upgradeUsersAction,
    },
    {
      key: "storage",
      title: "Storage",
      value: `${usedStorageLabel} / ${includedStorageLabel}`,
      action: upgradeStorageAction,
    },

    {
      key: "credits",
      title: "WEBKNOSSOS Credits",
      value: "2",
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
              <SettingsCard title={stat.title} description={stat.value} action={stat.action} />
            </Col>
          ))}
        </Row>
      </Spin>
      <PlanExpirationCard organization={organization} />
      <SettingsTitle
        title="Unlock more features"
        description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
      />
      <PlanUpgradeCard organization={organization} />
    </>
  );
}

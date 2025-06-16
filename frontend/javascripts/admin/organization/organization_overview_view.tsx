import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus, getUsers } from "admin/rest_api";
import { Col, Row, Spin } from "antd";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { useEffect, useState } from "react";
import type { APIOrganization, APIPricingPlanStatus } from "types/api_types";
import { SettingsCard } from "../account/helpers/settings_card";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { getActiveUserCount } from "./pricing_plan_utils";

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

  const maxUsersCountLabel =
    organization.includedUsers === Number.POSITIVE_INFINITY ? "∞" : organization.includedUsers;

  const includedStorageLabel =
    organization.includedStorageBytes === Number.POSITIVE_INFINITY
      ? "∞"
      : formatCountToDataAmountUnit(organization.includedStorageBytes, true);

  const usedStorageLabel = formatCountToDataAmountUnit(organization.usedStorageBytes, true);

  const firstRowStats = [
    {
      key: "owner",
      title: "Owner",
      value: "John Doe",
    },
    {
      key: "plan",
      title: "Current Plan",
      value: "Basic",
    },
  ];

  const secondRowStats = [
    {
      key: "users",
      title: "Users",
      value: `${activeUsersCount}/${maxUsersCountLabel}`,
    },
    {
      key: "storage",
      title: "Storage",
      value: `${usedStorageLabel} / ${includedStorageLabel}`,
    },

    {
      key: "credits",
      title: "WEBKNOSSOS Credits",
      value: "2",
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
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {firstRowStats.map((stat) => (
            <Col span={8} key={stat.key}>
              <SettingsCard title={stat.title} description={stat.value} />
            </Col>
          ))}
        </Row>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {secondRowStats.map((stat) => (
            <Col span={8} key={stat.key}>
              <SettingsCard title={stat.title} description={stat.value} />
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

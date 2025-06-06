import type { APIOrganization, APIPricingPlanStatus } from "types/api_types";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { useEffect, useState } from "react";
import { getPricingPlanStatus, getUsers } from "admin/rest_api";
import {
  getActiveUserCount,
  hasPricingPlanExceededStorage,
  hasPricingPlanExceededUsers,
} from "./pricing_plan_utils";
import { Card, Row, Col, Spin, Typography } from "antd";
import { AccountSettingsTitle } from "admin/account/account_profile_view";
import { formatCountToDataAmountUnit } from "libs/format_utils";

export function OrganizationProfileView({ organization }: { organization: APIOrganization }) {
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

  const hasExceededUserLimit = hasPricingPlanExceededUsers(organization, activeUsersCount);
  const hasExceededStorageLimit = hasPricingPlanExceededStorage(organization);

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
      <AccountSettingsTitle title={organization.name} description="Manage your organization." />
      {pricingPlanStatus?.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus?.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <Spin spinning={isFetchingData}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {firstRowStats.map((stat) => (
            <Col span={8} key={stat.key}>
              <Card>
                <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                  {stat.title}
                </Typography.Text>
                <div style={{ fontSize: 16, marginTop: 4 }}>{stat.value}</div>
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={16} style={{ marginBottom: 36 }}>
          {secondRowStats.map((stat) => (
            <Col span={8} key={stat.key}>
              <Card>
                <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                  {stat.title}
                </Typography.Text>
                <div style={{ fontSize: 16, marginTop: 4 }}>{stat.value}</div>
              </Card>
            </Col>
          ))}
        </Row>
      </Spin>
      <PlanExpirationCard organization={organization} />
      <AccountSettingsTitle
        title="Unlock more features"
        description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
      />
      <PlanUpgradeCard organization={organization} />
    </>
  );
}

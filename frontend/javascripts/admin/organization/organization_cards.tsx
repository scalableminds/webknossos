import {
  FieldTimeOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Progress, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import React from "react";
import { APIOrganization } from "types/api_flow_types";
import { PricingPlanEnum } from "./organization_edit_view";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (
    organization.pricingPlan === PricingPlanEnum.Power ||
    organization.pricingPlan === PricingPlanEnum.PowerTrial ||
    organization.pricingPlan === PricingPlanEnum.Custom
  )
    return null;

  let title = `Upgrade to ${PricingPlanEnum.Team} Plan`;
  let featureDescriptions = ["TODO", "TODO", "TODO"];
  let onOkCallback = UpgradePricingPlanModal.open;

  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    let title = `Upgrade to ${PricingPlanEnum.Power} Plan`;
    let featureDescriptions = ["TODO", "TODO", "TODO"];
  }

  return (
    <Card
      title={title}
      style={{ marginBottom: 20 }}
      headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
    >
      <Row gutter={24}>
        <Col flex="auto">
          <ul>
            {featureDescriptions.map((feature) => (
              <li>{feature}</li>
            ))}
          </ul>
        </Col>
        <Col span={6}>
          <Button type="primary" icon={<RocketOutlined />} onClick={onOkCallback}>
            Upgrade Now
          </Button>
        </Col>
      </Row>
    </Card>
  );
}

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <Row gutter={24}>
        <Col flex="auto">
          Paid Until {formatDateInLocalTimeZone(organization.paidUntil, "YYYY-MM-DD")}
        </Col>
        <Col span={6}>
          <Button type="primary" icon={<FieldTimeOutlined />}>
            Extend Now
          </Button>
        </Col>
      </Row>
    </Card>
  );
}

export function PlanDashboardCard({ organization }: { organization: APIOrganization }) {
  const activeUsers = 3;
  const usedStorageMB = 900;

  const usedUsersPercentage = (activeUsers / organization.includedUsers) * 100;
  const usedStoragePercentage = (usedStorageMB / organization.includedStorage) * 100;

  const usedStorageLabel =
    organization.pricingPlan == PricingPlanEnum.Free
      ? `${usedStorageMB / 1000}/${organization.includedStorage / 1000}GB`
      : `${usedStorageMB / 1000 ** 2}/${organization.includedStorage / 1000 ** 2}TB`;

  const redStrokeColor = "#ff4d4f";
  const greenStrokeColor = "#52c41a";

  return (
    <>
      {usedStoragePercentage > 100 || usedUsersPercentage > 100 ? (
        <Alert
          showIcon
          type="warning"
          message="Your organization is using more users or storage space than included in your current plan. Upgrade now to avoid your account being blocked."
          action={
            <Button size="small" type="primary">
              Upgrade Now
            </Button>
          }
          style={{ marginBottom: 20 }}
        />
      ) : null}
      <Row gutter={24} justify="space-between" align="stretch" style={{ marginBottom: 20 }}>
        <Col>
          <Card
            actions={[
              <span>
                <PlusCircleOutlined /> Upgrade
              </span>,
            ]}
          >
            <Row style={{ padding: 20 }}>
              <Progress
                type="dashboard"
                percent={usedUsersPercentage}
                format={() => `${activeUsers}/${organization.includedUsers}`}
                strokeColor={usedUsersPercentage > 100 ? redStrokeColor : greenStrokeColor}
                status={usedUsersPercentage > 100 ? "exception" : "active"}
              />
            </Row>
            <Row justify="center">Users</Row>
          </Card>
        </Col>
        <Col>
          <Card
            actions={[
              <span>
                <PlusCircleOutlined /> Upgrade
              </span>,
            ]}
          >
            <Row style={{ padding: 20 }}>
              <Progress
                type="dashboard"
                percent={usedStoragePercentage}
                format={() => usedStorageLabel}
                strokeColor={usedStoragePercentage > 100 ? redStrokeColor : greenStrokeColor}
                status={usedStoragePercentage > 100 ? "exception" : "active"}
              />
            </Row>
            <Row justify="center">Storage</Row>
          </Card>
        </Col>
        <Col>
          <Card
            actions={[
              <a href="https://webknossos.org/pricing" target={"_blank"}>
                <SafetyOutlined /> Compare Plans
              </a>,
            ]}
          >
            <Row justify="center" align="middle" style={{ minHeight: 160, padding: "25px 35px" }}>
              <h3>{organization.pricingPlan}</h3>
            </Row>
            <Row justify="center">Current Plan</Row>
          </Card>
        </Col>
      </Row>
    </>
  );
}

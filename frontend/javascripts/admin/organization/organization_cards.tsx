import {
  FieldTimeOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Progress, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import { formatBytes } from "libs/format_utils";
import React from "react";
import { APIOrganization } from "types/api_flow_types";
import { PricingPlanEnum } from "./organization_edit_view";

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (organization.pricingPlan === PricingPlanEnum.Free)
    return (
      <Card
        title="Upgrade to Team Plan"
        style={{ marginBottom: 20 }}
        headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
      >
        <Row gutter={24}>
          <Col flex="auto">
            <ul>
              <li>TODO</li>
              <li>TODO</li>
              <li>TODO</li>
            </ul>
          </Col>
          <Col span={6}>
            <Button type="primary" icon={<RocketOutlined />}>
              Upgrade Now
            </Button>
          </Col>
        </Row>
      </Card>
    );

  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum["Team-Trial"]
  )
    return (
      <Card
        title="Upgrade to Power Plan"
        style={{ marginBottom: 20 }}
        headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
      >
        <Row gutter={24}>
          <Col flex="auto">
            <ul>
              <li>Advanced segmentation proof-reading tools</li>
              <li>Unlimited users</li>
              <li>Custom hosting solutions available</li>
            </ul>
          </Col>
          <Col span={6}>
            <Button type="primary" icon={<RocketOutlined />}>
              Upgrade Now
            </Button>
          </Col>
        </Row>
      </Card>
    );

  return null;
}

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <Row gutter={24}>
        <Col flex="auto">Paid Until {formatDateInLocalTimeZone(organization.paidUntil)}</Col>
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
  const activeUsers = 6;
  const usedStorageMB = 1000;

  const usedUsersPercentage = (activeUsers / organization.includedUsers) * 100;
  const usedStoragePercentage = (usedStorageMB / organization.includedStorage) * 100;

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
                success={{ strokeColor: "#ff4d4f !important" }}
                style={{ color: usedUsersPercentage > 100 ? "#ff4d4f !important" : "inherit" }}
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
                format={() =>
                  `${formatBytes((usedStorageMB * 1024) ^ 2)} / ${formatBytes(
                    (organization.includedStorage * 1024) ^ 2,
                  )}`
                }
                style={{ color: usedStoragePercentage > 100 ? "#ff4d4f" : "inherit" }}
                success={{ strokeColor: "#ff4d4f" }}
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

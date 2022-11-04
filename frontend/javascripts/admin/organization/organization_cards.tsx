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
import { powerPlanFeatures, teamPlanFeatures } from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (
    organization.pricingPlan === PricingPlanEnum.Power ||
    organization.pricingPlan === PricingPlanEnum.PowerTrial ||
    organization.pricingPlan === PricingPlanEnum.Custom
  )
    return null;

  let title = `Upgrade to ${PricingPlanEnum.Team} Plan`;
  let featureDescriptions = teamPlanFeatures;

  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    title = `Upgrade to ${PricingPlanEnum.Power} Plan`;
    featureDescriptions = powerPlanFeatures;
  }

  return (
    <Card
      title={title}
      style={{
        marginBottom: 20,
        background:
          "linear-gradient(rgba(9, 109, 217,  0.8), rgba(9, 109, 217,  0.7)), url(/assets/images/background_neuron_meshes.webp) 53.75% 15.25% / cover no-repeat",
        color: "white",
      }}
      headStyle={{ backgroundColor: "rgb(245, 245, 245" }}
    >
      <Row gutter={24}>
        <Col span={18}>
          <p>
            Upgrading your webKnossos plan will unlock more advanced features and increase your user
            and storage quotas.
          </p>
          <p>Upgrade Highlights include:</p>
          <ul>
            {featureDescriptions.map((feature) => (
              <li key={feature.slice(0, 10)}>{feature}</li>
            ))}
          </ul>
        </Col>
        <Col span={6}>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={UpgradePricingPlanModal.upgradePricingPlan}
            style={{ borderColor: "white" }}
          >
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
          Your current plan is paid until{" "}
          {formatDateInLocalTimeZone(organization.paidUntil, "YYYY-MM-DD")}
        </Col>
        <Col span={6}>
          <Button
            type="primary"
            icon={<FieldTimeOutlined />}
            onClick={UpgradePricingPlanModal.extendPricingPlan}
          >
            Extend Now
          </Button>
        </Col>
      </Row>
    </Card>
  );
}

export function PlanDashboardCard({
  organization,
  activeUsersCount,
}: {
  organization: APIOrganization;
  activeUsersCount: number;
}) {
  const usedStorageMB = 900;

  const usedUsersPercentage = (activeUsersCount / organization.includedUsers) * 100;
  const usedStoragePercentage = (usedStorageMB / organization.includedStorage) * 100;

  const usedStorageLabel =
    organization.pricingPlan === PricingPlanEnum.Free
      ? `${(usedStorageMB / 1000).toFixed(1)}/${(organization.includedStorage / 1000).toFixed(1)}GB`
      : `${(usedStorageMB / 1000 ** 2).toFixed(1)}/${(organization.includedStorage / 1000 ** 2).toFixed(1)}TB`;

  const redStrokeColor = "#ff4d4f";
  const greenStrokeColor = "#52c41a";

  let upgradeUsersAction: React.ReactNode[] = [];
  let upgradeStorageAction: React.ReactNode[] = [];
  if (
    organization.pricingPlan === PricingPlanEnum.Free ||
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    upgradeUsersAction = [
      <span
        key="upgradeUsersAction"
        onClick={
          organization.pricingPlan === PricingPlanEnum.Free
            ? UpgradePricingPlanModal.upgradePricingPlan
            : UpgradePricingPlanModal.upgradeUserQuota
        }
      >
        <PlusCircleOutlined /> Upgrade
      </span>,
    ];
    upgradeStorageAction = [
      <span
        key="upgradeStorageAction"
        onClick={
          organization.pricingPlan === PricingPlanEnum.Free
            ? UpgradePricingPlanModal.upgradePricingPlan
            : UpgradePricingPlanModal.upgradeStorageQuota
        }
      >
        <PlusCircleOutlined /> Upgrade
      </span>,
    ];
  }

  return (
    <>
      {usedStoragePercentage > 100 || usedUsersPercentage > 100 ? (
        <Alert
          showIcon
          type="warning"
          message="Your organization is using more users or storage space than included in your current plan. Upgrade now to avoid your account being blocked."
          action={
            <Button
              size="small"
              type="primary"
              onClick={UpgradePricingPlanModal.upgradePricingPlan}
            >
              Upgrade Now
            </Button>
          }
          style={{ marginBottom: 20 }}
        />
      ) : null}
      <Row gutter={24} justify="space-between" align="stretch" style={{ marginBottom: 20 }}>
        <Col>
          <Card actions={upgradeUsersAction}>
            <Row style={{ padding: 20 }}>
              <Progress
                type="dashboard"
                percent={usedUsersPercentage}
                format={() => `${activeUsersCount}/${organization.includedUsers}`}
                strokeColor={usedUsersPercentage > 100 ? redStrokeColor : greenStrokeColor}
                status={usedUsersPercentage > 100 ? "exception" : "active"}
              />
            </Row>
            <Row justify="center">Users</Row>
          </Card>
        </Col>
        <Col>
          <Card actions={upgradeStorageAction}>
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
              <a
                href="https://webknossos.org/pricing"
                target="_blank"
                rel="noreferrer"
                key="comparePlanAction"
              >
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

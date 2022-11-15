import {
  FieldTimeOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { getOrganizationStorageSpace } from "admin/admin_rest_api";
import { Alert, Button, Card, Col, Progress, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import { useFetch } from "libs/react_helpers";
import moment from "moment";
import React from "react";
import { APIOrganization } from "types/api_flow_types";
import { PricingPlanEnum } from "./organization_edit_view";
import {
  powerPlanFeatures,
  storageWarningThresholdMB,
  teamPlanFeatures,
} from "./pricing_plan_utils";
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
      }}
      bodyStyle={{
        background:
          "linear-gradient(rgba(9, 109, 217,  0.8), rgba(9, 109, 217,  0.7)), url(/assets/images/pricing/background_neuron_meshes.jpeg) 10% center / 120% no-repeat",
        color: "white",
      }}
      headStyle={{ backgroundColor: "rgb(250, 250, 250)" }}
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
            onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
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
  if (organization.pricingPlan === PricingPlanEnum.Free) return null;

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
            onClick={() => UpgradePricingPlanModal.extendPricingPlan(organization)}
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
  const usedStorageSpace = useFetch(
    () => getOrganizationStorageSpace(organization.name),
    { usedStorageSpace: 0 },
    [],
  );
  const usedStorageMB = usedStorageSpace.usedStorageSpace;

  const usedUsersPercentage = (activeUsersCount / organization.includedUsers) * 100;
  const usedStoragePercentage = (usedStorageMB / organization.includedStorage) * 100;

  const hasExceededUserLimit = usedUsersPercentage > 100;
  const hasExceededStorageLimit = usedStoragePercentage > 100;
  const hasPlanExpired = Date.now() > organization.paidUntil;

  const maxUsersCountLabel =
    organization.includedUsers === Number.POSITIVE_INFINITY ? "∞" : organization.includedUsers;

  let includedStorageLabel =
    organization.pricingPlan === PricingPlanEnum.Free
      ? `${(organization.includedStorage / 1000).toFixed(1)}GB`
      : `${(organization.includedStorage / 1000 ** 2).toFixed(1)}TB`;
  includedStorageLabel =
    organization.includedStorage === Number.POSITIVE_INFINITY ? "∞" : includedStorageLabel;

  const usedStorageLabel =
    organization.pricingPlan === PricingPlanEnum.Free
      ? `${(usedStorageMB / 1000).toFixed(1)}`
      : `${(usedStorageMB / 1000 ** 2).toFixed(1)}`;

  const storageLabel = `${usedStorageLabel}/${includedStorageLabel}`;

  const hasPlanExceeded = hasExceededStorageLimit || hasExceededUserLimit || hasPlanExpired;

  const redStrokeColor = "#ff4d4f";
  const greenStrokeColor = "#52c41a";

  let upgradeUsersAction: React.ReactNode[] = [];
  let upgradeStorageAction: React.ReactNode[] = [];
  let upgradePlanAction: React.ReactNode[] = [];

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
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
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
            ? () => UpgradePricingPlanModal.upgradePricingPlan(organization)
            : UpgradePricingPlanModal.upgradeStorageQuota
        }
      >
        <PlusCircleOutlined /> Upgrade
      </span>,
    ];
    upgradePlanAction = [
      [
        <a
          href="https://webknossos.org/pricing"
          target="_blank"
          rel="noreferrer"
          key="comparePlanAction"
        >
          <SafetyOutlined /> Compare Plans
        </a>,
      ],
    ];
  }

  return (
    <>
      {hasPlanExceeded ? (
        <PlanExceededAlert organization={organization} />
      ) : (
        <PlanAboutToExceedWarning
          organization={organization}
          usedStorageSpace={usedStorageSpace.usedStorageSpace}
        />
      )}
      <Row gutter={24} justify="space-between" align="stretch" style={{ marginBottom: 20 }}>
        <Col>
          <Card actions={upgradeUsersAction}>
            <Row style={{ padding: "20px 35px" }}>
              <Progress
                type="dashboard"
                percent={usedUsersPercentage}
                format={() => `${activeUsersCount}/${maxUsersCountLabel}`}
                strokeColor={hasExceededUserLimit ? redStrokeColor : greenStrokeColor}
                status={hasExceededUserLimit ? "exception" : "active"}
              />
            </Row>
            <Row justify="center">Users</Row>
          </Card>
        </Col>
        <Col>
          <Card actions={upgradeStorageAction}>
            <Row style={{ padding: "20px 35px" }}>
              <Progress
                type="dashboard"
                percent={usedStoragePercentage}
                format={() => storageLabel}
                strokeColor={hasExceededStorageLimit ? redStrokeColor : greenStrokeColor}
                status={hasExceededStorageLimit ? "exception" : "active"}
              />
            </Row>
            <Row justify="center">Storage</Row>
          </Card>
        </Col>
        <Col>
          <Card actions={upgradePlanAction}>
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

function PlanExceededAlert({ organization }: { organization: APIOrganization }) {
  const hasPlanExpired = Date.now() > organization.paidUntil;

  const message = hasPlanExpired
    ? "Your webKnossos plan has expired. Renew your plan now to avoid being downgraded and lose access to features and prevent users from being blocked."
    : "Your organization is using more users or storage space than included in your current plan. Upgrade now to avoid your account from being blocked.";
  const actionButton = hasPlanExpired ? (
    <Button
      size="small"
      type="primary"
      onClick={() => UpgradePricingPlanModal.extendPricingPlan(organization)}
    >
      Extend Plan Now
    </Button>
  ) : (
    <Button
      size="small"
      type="primary"
      onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
    >
      Upgrade Now
    </Button>
  );

  return (
    <Alert
      showIcon
      type="error"
      message={message}
      action={actionButton}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedWarning({
  organization,
  usedStorageSpace,
}: {
  organization: APIOrganization;
  usedStorageSpace: number;
}) {
  const alerts = [];
  const isAboutToExpire =
    moment.duration(moment(organization.paidUntil).diff(moment())).asWeeks() <= 6;

  const isAboutToExceedStorage =
    usedStorageSpace >= organization.includedStorage - storageWarningThresholdMB;

  if (isAboutToExpire)
    alerts.push({
      message:
        "Your webKnossos plan is about to expire soon. Renew your plan now to avoid being downgraded and lose access to features and prevent users from being blocked.",
      actionButton: (
        <Button
          size="small"
          type="primary"
          onClick={() => UpgradePricingPlanModal.extendPricingPlan(organization)}
        >
          Extend Plan Now
        </Button>
      ),
    });

  if (isAboutToExceedStorage)
    alerts.push({
      message:
        "Your organization is about to exceed the storage space included in your current plan. Upgrade now to avoid your account from being blocked.",
      actionButton: (
        <Button
          size="small"
          type="primary"
          onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
        >
          Upgrade Now
        </Button>
      ),
    });

  if (!isAboutToExpire && !isAboutToExceedStorage) return null;

  return (
    <>
      {alerts.map((alert) => (
        <Alert
          key={alert.message.slice(0, 10)}
          showIcon
          type="warning"
          message={alert.message}
          action={alert.actionButton}
          style={{ marginBottom: 20 }}
        />
      ))}
    </>
  );
}

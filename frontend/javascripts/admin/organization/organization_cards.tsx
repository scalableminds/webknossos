import {
  FieldTimeOutlined,
  PlusCircleOutlined,
  RocketOutlined,
  SafetyOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Progress, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import Constants from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import type React from "react";
import { useSelector } from "react-redux";
import type { APIOrganization } from "types/api_flow_types";
import {
  PricingPlanEnum,
  hasPricingPlanExceededStorage,
  hasPricingPlanExceededUsers,
  hasPricingPlanExpired,
  isUserAllowedToRequestUpgrades,
  powerPlanFeatures,
  teamPlanFeatures,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

export function TeamAndPowerPlanUpgradeCards({
  teamUpgradeCallback,
  powerUpgradeCallback,
}: {
  teamUpgradeCallback: () => void;
  powerUpgradeCallback: () => void;
}) {
  return (
    <Row gutter={24}>
      <Col span={12}>
        <Card
          title={`${PricingPlanEnum.Team} Plan`}
          styles={{ body: { minHeight: 220, opacity: 0.8 } }}
          actions={[
            <Button type="primary" onClick={teamUpgradeCallback} key="buy-teamupgrade-button">
              <PlusCircleOutlined /> Buy Upgrade
            </Button>,
          ]}
        >
          <ul>
            {teamPlanFeatures.map((feature) => (
              <li key={feature.slice(0, 10)}>{feature}</li>
            ))}
          </ul>
        </Card>
      </Col>
      <Col span={12}>
        <Card
          title={`${PricingPlanEnum.Power} Plan`}
          styles={{ body: { minHeight: 220, opacity: 0.8 } }}
          actions={[
            <Button type="primary" onClick={powerUpgradeCallback} key="buy-power-upgrade-button">
              <PlusCircleOutlined /> Buy Upgrade
            </Button>,
          ]}
        >
          <ul>
            {powerPlanFeatures.map((feature) => (
              <li key={feature.slice(0, 10)}>{feature}</li>
            ))}
          </ul>
        </Card>
      </Col>
    </Row>
  );
}

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (
    organization.pricingPlan === PricingPlanEnum.Power ||
    organization.pricingPlan === PricingPlanEnum.PowerTrial ||
    organization.pricingPlan === PricingPlanEnum.Custom
  )
    return null;

  let title = "Upgrade to unlock more features";
  let cardBody = (
    <TeamAndPowerPlanUpgradeCards
      teamUpgradeCallback={() =>
        UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Team)
      }
      powerUpgradeCallback={() =>
        UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Power)
      }
    />
  );

  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    title = `Upgrade to ${PricingPlanEnum.Power} Plan`;
    cardBody = (
      <Row gutter={24}>
        <Col span={18}>
          <p>
            Upgrading your WEBKNOSSOS plan will unlock more advanced features and increase your user
            and storage quotas.
          </p>
          <p>
            <ul>
              {powerPlanFeatures.map((feature) => (
                <li key={feature.slice(0, 10)}>{feature}</li>
              ))}
            </ul>
          </p>
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
    );
  }

  return (
    <Card
      title={title}
      style={{
        marginBottom: 20,
      }}
      styles={{
        body: {
          background: "var(--color-wk-blue)",
          color: "white",
        },
      }}
    >
      <p>
        Upgrading your WEBKNOSSOS plan will unlock more advanced features and increase your user and
        storage quotas.
      </p>
      {cardBody}
    </Card>
  );
}

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  if (organization.paidUntil === Constants.MAXIMUM_DATE_TIMESTAMP) return null;

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
  const usedUsersPercentage = (activeUsersCount / organization.includedUsers) * 100;
  const usedStoragePercentage =
    (organization.usedStorageBytes / organization.includedStorageBytes) * 100;

  const hasExceededUserLimit = hasPricingPlanExceededUsers(organization, activeUsersCount);
  const hasExceededStorageLimit = hasPricingPlanExceededStorage(organization);

  const maxUsersCountLabel =
    organization.includedUsers === Number.POSITIVE_INFINITY ? "∞" : organization.includedUsers;

  const includedStorageLabel =
    organization.includedStorageBytes === Number.POSITIVE_INFINITY
      ? "∞"
      : formatCountToDataAmountUnit(organization.includedStorageBytes, true);

  const usedStorageLabel = formatCountToDataAmountUnit(organization.usedStorageBytes, true);

  const storageLabel = (
    <span style={{ display: "inline-block", wordBreak: "break-word", width: 100 }}>
      {usedStorageLabel} /
      <wbr />
      {includedStorageLabel}
    </span>
  );

  const redStrokeColor = "#ff4d4f";
  const greenStrokeColor = "#52c41a";

  let upgradeUsersAction: React.ReactNode[] = [];
  let upgradeStorageAction: React.ReactNode[] = [];
  let upgradePlanAction: React.ReactNode[] = [];

  if (
    organization.pricingPlan === PricingPlanEnum.Basic ||
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    upgradeUsersAction = [
      <span
        key="upgradeUsersAction"
        onClick={
          organization.pricingPlan === PricingPlanEnum.Basic
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
          organization.pricingPlan === PricingPlanEnum.Basic
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
          <Row justify="center" align="middle" style={{ minHeight: 160, width: 188 }}>
            <h3>{organization.pricingPlan}</h3>
          </Row>
          <Row justify="center">Current Plan</Row>
        </Card>
      </Col>
    </Row>
  );
}

export function PlanExceededAlert({ organization }: { organization: APIOrganization }) {
  const hasPlanExpired = hasPricingPlanExpired(organization);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const message = hasPlanExpired
    ? "Your WEBKNOSSOS plan has expired. Renew your plan now to avoid being downgraded, users being blocked, and losing access to features."
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
      action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedAlert({ organization }: { organization: APIOrganization }) {
  const alerts = [];
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isAboutToExpire =
    dayjs.duration(dayjs(organization.paidUntil).diff(dayjs())).asWeeks() <= 6 &&
    !hasPricingPlanExpired(organization);

  if (isAboutToExpire)
    alerts.push({
      message:
        "Your WEBKNOSSOS plan is about to expire soon. Renew your plan now to avoid being downgraded, users being blocked, and losing access to features.",
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
  // else {
  //   alerts.push({
  //     message:
  //       "Your organization is about to exceed the storage space included in your current plan. Upgrade now to avoid your account from being blocked.",
  //     actionButton: (
  //       <Button
  //         size="small"
  //         type="primary"
  //         onClick={() => UpgradePricingPlanModal.upgradePricingPlan(organization)}
  //       >
  //         Upgrade Now
  //       </Button>
  //     ),
  //   });
  // }

  return (
    <>
      {alerts.map((alert) => (
        <Alert
          key={alert.message.slice(0, 10)}
          showIcon
          type="warning"
          message={alert.message}
          action={
            activeUser && isUserAllowedToRequestUpgrades(activeUser) ? alert.actionButton : null
          }
          style={{ marginBottom: 20 }}
        />
      ))}
    </>
  );
}

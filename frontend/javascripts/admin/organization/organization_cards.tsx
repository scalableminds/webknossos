import {
  CrownOutlined,
  FieldTimeOutlined,
  PlusCircleOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Flex, Row, Space, Typography, theme } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { useWkSelector } from "libs/react_hooks";
import type { APIOrganization } from "types/api_types";
import Constants from "viewer/constants";
import { PowerPlanUpgradeCard, TeamPlanUpgradeCard } from "./plan_upgrade_cards";
import {
  aiAddonFeatures,
  hasPricingPlanExpired,
  isUserAllowedToRequestUpgrades,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";
import { useCanRequestUpgrades } from "./use_can_request_upgrades";

export function AiAddonUpgradeCard() {
  return (
    <Card
      title={
        <Space size="small">
          <RobotOutlined style={{ color: "var(--ant-color-primary)" }} />
          AI Add-on
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={() => UpgradePricingPlanModal.requestAiPlanUpgrade()}
          key="buy-ai-addon-button"
          icon={<PlusCircleOutlined />}
        >
          Buy AI Add-on
        </Button>,
      ]}
    >
      <div>
        Unlock AI add-on for advanced capabilities like model training for your organization.
        <ul>
          {aiAddonFeatures.map((feature) => (
            <li key={feature.slice(0, 10)}>{feature}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    return (
      <Row gutter={24}>
        <Col span={24}>
          <PowerPlanUpgradeCard
            description="Upgrade your organization to unlock more collaboration and proofreading features for your team."
            powerUpgradeCallback={() => UpgradePricingPlanModal.upgradePricingPlan()}
          />
        </Col>
      </Row>
    );
  }

  return (
    <Row gutter={24}>
      <Col span={12}>
        <TeamPlanUpgradeCard
          teamUpgradeCallback={() =>
            UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Team)
          }
        />
      </Col>
      <Col span={12}>
        <PowerPlanUpgradeCard
          powerUpgradeCallback={() =>
            UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Power)
          }
        />
      </Col>
    </Row>
  );
}

// Plans ending within this many weeks are highlighted as about to expire.
const PLAN_EXPIRATION_WARNING_WEEKS = 6;

function isPlanAboutToExpire(organization: APIOrganization): boolean {
  return (
    dayjs.duration(dayjs(organization.paidUntil).diff(dayjs())).asWeeks() <=
      PLAN_EXPIRATION_WARNING_WEEKS && !hasPricingPlanExpired(organization)
  );
}

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  const { token } = theme.useToken();
  const canRequestUpgrades = useCanRequestUpgrades();

  if (organization.paidUntil === Constants.MAXIMUM_DATE_TIMESTAMP) return null;

  const hasExpired = hasPricingPlanExpired(organization);
  const isUrgent = hasExpired || isPlanAboutToExpire(organization);
  const timeLeft = dayjs(organization.paidUntil).fromNow(true);
  const planName = organization.pricingPlan.replace("_", " ");

  let statusText: React.ReactNode;
  if (hasExpired) {
    statusText = "Your plan has ended. Extend it to restore all users and features.";
  } else if (isUrgent) {
    statusText = `Your plan ends in ${timeLeft}. Extend it to keep all users and features.`;
  } else {
    statusText = `Your next renewal is in ${timeLeft}.`;
  }

  return (
    <Card>
      <Flex align="center" gap={24} wrap>
        <Flex
          align="center"
          justify="center"
          style={{
            width: 48,
            height: 48,
            flex: "none",
            borderRadius: token.borderRadiusLG,
            background: isUrgent ? token.colorWarningBg : token.colorPrimaryBg,
            color: isUrgent ? token.colorWarning : token.colorPrimary,
            fontSize: 22,
          }}
        >
          <CrownOutlined />
        </Flex>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 16, display: "block" }}>
            {planName} · {hasExpired ? "expired on" : "paid until"}{" "}
            <FormattedDate timestamp={organization.paidUntil} dateOnly />
          </Typography.Text>
          <Typography.Text type={isUrgent ? "warning" : "secondary"}>
            {statusText}{" "}
            <a href="https://webknossos.org/pricing" target="_blank" rel="noopener noreferrer">
              Compare all plans
            </a>
          </Typography.Text>
        </div>
        {canRequestUpgrades ? (
          <Button
            type="primary"
            icon={<FieldTimeOutlined />}
            onClick={() => UpgradePricingPlanModal.extendPricingPlan()}
          >
            Extend Now
          </Button>
        ) : null}
      </Flex>
    </Card>
  );
}

export function PlanExceededAlert({ organization }: { organization: APIOrganization }) {
  const hasPlanExpired = hasPricingPlanExpired(organization);
  const activeUser = useWkSelector((state) => state.activeUser);

  const message = hasPlanExpired
    ? "Your WEBKNOSSOS plan has expired. Extend it to restore all users and features."
    : "Your organization is using more users or storage space than included in your current plan. Upgrade now to avoid your account from being blocked.";
  const actionButton = hasPlanExpired ? (
    <Button size="small" type="primary" onClick={() => UpgradePricingPlanModal.extendPricingPlan()}>
      Extend Plan Now
    </Button>
  ) : (
    <Button
      size="small"
      type="primary"
      onClick={() => UpgradePricingPlanModal.upgradePricingPlan()}
    >
      Upgrade Now
    </Button>
  );

  return (
    <Alert
      showIcon
      type="error"
      title={message}
      action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedAlert({ organization }: { organization: APIOrganization }) {
  const activeUser = useWkSelector((state) => state.activeUser);
  if (isPlanAboutToExpire(organization)) {
    const actionButton = (
      <Button
        size="small"
        type="primary"
        onClick={() => UpgradePricingPlanModal.extendPricingPlan()}
      >
        Extend Plan Now
      </Button>
    );

    return (
      <Alert
        showIcon
        type="warning"
        title={`Your WEBKNOSSOS plan ends ${dayjs(organization.paidUntil).fromNow()}. Extend it to keep all users and features.`}
        action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
        style={{ marginBottom: 20 }}
      />
    );
  } else return null;
}

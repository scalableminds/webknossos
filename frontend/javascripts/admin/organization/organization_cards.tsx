import {
  CrownOutlined,
  FieldTimeOutlined,
  PlusCircleOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Row, Space } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { useWkSelector } from "libs/react_hooks";
import type { APIOrganization } from "types/api_types";
import Constants from "viewer/constants";
import {
  aiAddonFeatures,
  hasPricingPlanExpired,
  isUserAllowedToRequestUpgrades,
  PricingPlanEnum,
  powerPlanFeatures,
  teamPlanFeatures,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

export function TeamPlanUpgradeCard({ teamUpgradeCallback }: { teamUpgradeCallback: () => void }) {
  return (
    <Card
      title={
        <Space size="small">
          <CrownOutlined style={{ color: "var(--ant-color-primary)" }} />
          {PricingPlanEnum.Team} Plan
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={teamUpgradeCallback}
          key="buy-teamupgrade-button"
          icon={<PlusCircleOutlined />}
        >
          Buy Upgrade
        </Button>,
      ]}
    >
      <ul>
        {teamPlanFeatures.map((feature) => (
          <li key={feature.slice(0, 10)}>{feature}</li>
        ))}
      </ul>
    </Card>
  );
}

export function PowerPlanUpgradeCard({
  powerUpgradeCallback,
  description,
}: {
  powerUpgradeCallback: () => void;
  description?: string;
}) {
  return (
    <Card
      title={
        <Space size="small">
          <CrownOutlined style={{ color: "var(--ant-color-primary)" }} />
          {PricingPlanEnum.Power} Plan
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={powerUpgradeCallback}
          key="buy-power-upgrade-button"
          icon={<PlusCircleOutlined />}
        >
          Buy Upgrade
        </Button>,
      ]}
    >
      <div>
        {description ? <p>{description}</p> : null}
        <ul>
          {powerPlanFeatures.map((feature) => (
            <li key={feature.slice(0, 10)}>{feature}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

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
            powerUpgradeCallback={() =>
              UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Power)
            }
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
            UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Team)
          }
        />
      </Col>
      <Col span={12}>
        <PowerPlanUpgradeCard
          powerUpgradeCallback={() =>
            UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Power)
          }
        />
      </Col>
    </Row>
  );
}

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  if (organization.paidUntil === Constants.MAXIMUM_DATE_TIMESTAMP) return null;

  return (
    <Card style={{ marginBottom: 36 }}>
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

export function PlanExceededAlert({ organization }: { organization: APIOrganization }) {
  const hasPlanExpired = hasPricingPlanExpired(organization);
  const activeUser = useWkSelector((state) => state.activeUser);

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
      title={message}
      action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedAlert({ organization }: { organization: APIOrganization }) {
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAboutToExpire =
    dayjs.duration(dayjs(organization.paidUntil).diff(dayjs())).asWeeks() <= 6 &&
    !hasPricingPlanExpired(organization);

  if (isAboutToExpire) {
    const actionButton = (
      <Button
        size="small"
        type="primary"
        onClick={() => UpgradePricingPlanModal.extendPricingPlan(organization)}
      >
        Extend Plan Now
      </Button>
    );

    return (
      <Alert
        showIcon
        type="warning"
        title="Your WEBKNOSSOS plan is about to expire soon. Renew your plan now to avoid being downgraded, users being blocked, and losing access to features."
        action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
        style={{ marginBottom: 20 }}
      />
    );
  } else return null;
}

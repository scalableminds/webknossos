import { FieldTimeOutlined, PlusCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import { useWkSelector } from "libs/react_hooks";
import type { APIOrganization } from "types/api_types";
import Constants from "viewer/constants";
import {
  PricingPlanEnum,
  customPlanFeatures,
  hasPricingPlanExpired,
  isUserAllowedToRequestUpgrades,
  powerPlanFeatures,
  teamPlanFeatures,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

function CustomPlanUpgradeCard() {
  return (
    <Card styles={{ body: { minHeight: 220 } }}>
      <p> Contact our support team to upgrade Webknossos to match your organization. </p>
      <ul>
        {customPlanFeatures.map((feature) => (
          <li key={feature.slice(0, 10)}>{feature}</li>
        ))}
      </ul>
      <Button type="primary" href="mailto:hello@webknossos.org">
        Contact Support
      </Button>
    </Card>
  );
}

function TeamPlanUpgradeCard({ teamUpgradeCallback }: { teamUpgradeCallback: () => void }) {
  return (
    <Card
      title={`${PricingPlanEnum.Team} Plan`}
      styles={{ body: { minHeight: 220 } }}
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
  );
}

function PowerPlanUpgradeCard({
  powerUpgradeCallback,
  description,
}: {
  powerUpgradeCallback: () => void;
  description?: string;
}) {
  return (
    <Card
      title={`${PricingPlanEnum.Power} Plan`}
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button type="primary" onClick={powerUpgradeCallback} key="buy-power-upgrade-button">
          <PlusCircleOutlined /> Buy Upgrade
        </Button>,
      ]}
    >
      {description ? <p>{description}</p> : null}
      <ul>
        {powerPlanFeatures.map((feature) => (
          <li key={feature.slice(0, 10)}>{feature}</li>
        ))}
      </ul>
    </Card>
  );
}

export function PlanUpgradeCard({ organization }: { organization: APIOrganization }) {
  if (
    organization.pricingPlan === PricingPlanEnum.Power ||
    organization.pricingPlan === PricingPlanEnum.PowerTrial ||
    organization.pricingPlan === PricingPlanEnum.Custom
  )
    <Row gutter={24}>
      <Col span={24}>
        <CustomPlanUpgradeCard />
      </Col>
    </Row>;

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
      message={message}
      action={activeUser && isUserAllowedToRequestUpgrades(activeUser) ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedAlert({ organization }: { organization: APIOrganization }) {
  const alerts = [];
  const activeUser = useWkSelector((state) => state.activeUser);
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
  else {
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
  }

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

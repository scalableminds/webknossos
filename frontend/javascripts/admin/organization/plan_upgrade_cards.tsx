import { CrownOutlined, PlusCircleOutlined, RobotOutlined } from "@ant-design/icons";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { Button, Card, Col, Row, Space } from "antd";
import type React from "react";
import type { APIOrganization } from "types/api_types";
import { useCanRequestUpgrades } from "./organization_hooks";
import {
  aiAddonFeatures,
  getBasePricingPlan,
  isAiAddonEligiblePlan,
  PricingPlanEnum,
  powerPlanFeatures,
  teamPlanFeatures,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const UPGRADE_DESCRIPTION =
  "Upgrade your organization to unlock more collaboration and proofreading features for your team.";

function UpgradeOfferCard({
  icon,
  title,
  description,
  features,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  features: string[];
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card
      title={
        <Space size="small">
          <span style={{ color: "var(--ant-color-primary)" }}>{icon}</span>
          {title}
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={onAction}
          key="upgrade-action"
          icon={<PlusCircleOutlined />}
        >
          {actionLabel}
        </Button>,
      ]}
    >
      {description ? <p>{description}</p> : null}
      <ul>
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </Card>
  );
}

function TeamPlanUpgradeCard() {
  return (
    <UpgradeOfferCard
      icon={<CrownOutlined />}
      title={`${PricingPlanEnum.Team} Plan`}
      features={teamPlanFeatures}
      actionLabel="Buy Upgrade"
      onAction={() => UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Team)}
    />
  );
}

function PowerPlanUpgradeCard({ description }: { description?: string }) {
  return (
    <UpgradeOfferCard
      icon={<CrownOutlined />}
      title={`${PricingPlanEnum.Power} Plan`}
      description={description}
      features={powerPlanFeatures}
      actionLabel="Buy Upgrade"
      onAction={() => UpgradePricingPlanModal.upgradePricingPlan(PricingPlanEnum.Power)}
    />
  );
}

export function AiAddonUpgradeCard() {
  return (
    <UpgradeOfferCard
      icon={<RobotOutlined />}
      title="AI Add-on"
      description="Unlock AI add-on for advanced capabilities like model training for your organization."
      features={aiAddonFeatures}
      actionLabel="Buy AI Add-on"
      onAction={() => UpgradePricingPlanModal.requestAiPlanUpgrade()}
    />
  );
}

// The plan upgrades and add-ons the organization can still buy, side by side.
export function UpgradeOfferCards({ organization }: { organization: APIOrganization }) {
  const canRequestUpgrades = useCanRequestUpgrades();
  if (!canRequestUpgrades) return null;

  const basePlan = getBasePricingPlan(organization.pricingPlan);
  const offers: React.ReactElement[] = [];
  if (basePlan === PricingPlanEnum.Personal) {
    offers.push(<TeamPlanUpgradeCard key="team" />, <PowerPlanUpgradeCard key="power" />);
  } else if (basePlan === PricingPlanEnum.Team) {
    offers.push(<PowerPlanUpgradeCard key="power" description={UPGRADE_DESCRIPTION} />);
  }
  if (organization.aiPlan == null && isAiAddonEligiblePlan(organization.pricingPlan)) {
    offers.push(<AiAddonUpgradeCard key="ai-addon" />);
  }
  if (offers.length === 0) return null;

  return (
    <div>
      <SettingsTitle title="Unlock more features" description={UPGRADE_DESCRIPTION} />
      <Row gutter={24} style={{ marginTop: 24 }}>
        {offers.map((offer) => (
          <Col span={24 / offers.length} key={offer.key}>
            {offer}
          </Col>
        ))}
      </Row>
    </div>
  );
}

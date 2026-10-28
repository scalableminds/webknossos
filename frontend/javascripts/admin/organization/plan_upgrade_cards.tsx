import {
  CrownOutlined,
  MailOutlined,
  PlusCircleOutlined,
  RobotOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { Button, Card, Col, Row, Space } from "antd";
import type React from "react";
import type { APIOrganization } from "types/api_types";
import { useCanRequestUpgrades, useShouldContactSalesForUpgrades } from "./organization_hooks";
import {
  aiAddonFeatures,
  contactSales,
  isAiAddonEligiblePlan,
  PricingPlanEnum,
  powerPlanFeatures,
  teamPlanFeatures,
} from "./pricing_plan_utils";
import { getPlanTier, getUpgradeTargetTiers } from "./upgrade_modal/upgrade_request_items";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

const UPGRADE_DESCRIPTION =
  "Upgrade your organization to unlock more collaboration and proofreading features for your team.";

function UpgradeOfferCard({
  icon,
  title,
  description,
  features,
  actionLabel,
  actionIcon = <PlusCircleOutlined />,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  features: string[];
  actionLabel: string;
  actionIcon?: React.ReactNode;
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
        <Button type="primary" onClick={onAction} key="upgrade-action" icon={actionIcon}>
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

const SELF_HOSTED_UPGRADE_DESCRIPTION =
  "Get AI analysis, processing jobs and proofreading for your organization.";

const selfHostedUpgradeFeatures = [
  "AI analysis: neuron, mitochondria and instance segmentation",
  "Train custom AI models on your data",
  "AI-based quick-select tool",
  "Processing jobs: precomputed meshes, TIFF exports, conversions and animations",
  "Segmentation Proof-Reading Tool",
  "Hosted on webknossos.org, or on-premise with your HPC and storage servers",
];

function ContactSalesCard() {
  return (
    <UpgradeOfferCard
      icon={<RocketOutlined />}
      title="Unlock AI and processing jobs"
      description="Your self-hosted WEBKNOSSOS runs on the free Open Source plan. Talk to us about a hosted Team or Power plan on webknossos.org, or an Enterprise plan for your own servers."
      features={selfHostedUpgradeFeatures}
      actionLabel="Contact Sales"
      actionIcon={<MailOutlined />}
      onAction={contactSales}
    />
  );
}

// The plan upgrades and add-ons the organization can still buy, side by side.
export function UpgradeOfferCards({ organization }: { organization: APIOrganization }) {
  const canRequestUpgrades = useCanRequestUpgrades();
  const shouldContactSales = useShouldContactSalesForUpgrades();
  if (!canRequestUpgrades) return null;

  const targetTiers = shouldContactSales
    ? []
    : getUpgradeTargetTiers(getPlanTier(organization.pricingPlan));
  const offers: React.ReactElement[] = [];
  if (shouldContactSales) {
    offers.push(<ContactSalesCard key="contact-sales" />);
  }
  if (targetTiers.includes(PricingPlanEnum.Team)) {
    offers.push(<TeamPlanUpgradeCard key="team" />);
  }
  if (targetTiers.includes(PricingPlanEnum.Power)) {
    // The description is only repeated on the card if it is the only plan offer.
    const description = targetTiers.length === 1 ? UPGRADE_DESCRIPTION : undefined;
    offers.push(<PowerPlanUpgradeCard key="power" description={description} />);
  }
  if (organization.aiPlan == null && isAiAddonEligiblePlan(organization.pricingPlan)) {
    offers.push(<AiAddonUpgradeCard key="ai-addon" />);
  }
  if (offers.length === 0) return null;

  return (
    <div>
      <SettingsTitle
        title="Unlock more features"
        description={shouldContactSales ? SELF_HOSTED_UPGRADE_DESCRIPTION : UPGRADE_DESCRIPTION}
      />
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

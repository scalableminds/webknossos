import { FieldTimeOutlined, RobotOutlined, TeamOutlined } from "@ant-design/icons";
import { App, Button, Flex, Progress, Typography } from "antd";
import dayjs from "dayjs";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import type React from "react";
import type { APIOrganization } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import {
  getAiAddonIncludedCredits,
  getBasePricingPlan,
  getDaysUntilPlanExpires,
  isAiAddonEligiblePlan,
  isTrialPlan,
  isUserAllowedToRequestUpgrades,
  PLAN_EXPIRATION_REMINDER_DAYS,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

type SidebarUpsell =
  | { kind: "planExpiring"; daysLeft: number }
  | { kind: "teamUpgrade" }
  | { kind: "aiAddon"; includedCredits: number };

function getSidebarUpsell(organization: APIOrganization): SidebarUpsell | null {
  const daysLeft = getDaysUntilPlanExpires(organization);
  if (
    daysLeft != null &&
    daysLeft > 0 &&
    (isTrialPlan(organization.pricingPlan) || daysLeft <= PLAN_EXPIRATION_REMINDER_DAYS)
  ) {
    return { kind: "planExpiring", daysLeft };
  }
  if (organization.pricingPlan === PricingPlanEnum.Personal) {
    return { kind: "teamUpgrade" };
  }
  if (organization.aiPlan == null && isAiAddonEligiblePlan(organization.pricingPlan)) {
    return {
      kind: "aiAddon",
      includedCredits: getAiAddonIncludedCredits(organization.pricingPlan),
    };
  }
  return null;
}

function useSidebarUpsell(): SidebarUpsell | null {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const canRequestUpgrades = useWkSelector((state) =>
    state.activeUser ? isUserAllowedToRequestUpgrades(state.activeUser) : false,
  );
  return canRequestUpgrades ? getSidebarUpsell(organization) : null;
}

function UpsellCard({
  icon,
  title,
  description,
  progressPercent,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  progressPercent?: number;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Flex
      vertical
      gap={8}
      style={{
        padding: 16,
        borderRadius: 6,
        border: "1px solid var(--ant-color-primary-border)",
        background: "var(--ant-color-primary-bg)",
      }}
    >
      <Flex gap={8} align="baseline">
        <span style={{ color: "var(--ant-color-primary)", fontSize: 14 }}>{icon}</span>
        <Typography.Text strong>{title}</Typography.Text>
      </Flex>
      {progressPercent != null ? (
        <Progress
          percent={progressPercent}
          showInfo={false}
          size={{ height: 6 }}
          railColor="var(--ant-color-primary-border)"
          style={{ margin: 0, lineHeight: 0 }}
        />
      ) : null}
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {description}
      </Typography.Text>
      <Button type="primary" size="small" onClick={onAction} style={{ alignSelf: "flex-start" }}>
        {actionLabel}
      </Button>
    </Flex>
  );
}

function PlanExpiringUpsellCard({ daysLeft }: { daysLeft: number }) {
  const { modal } = App.useApp();
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const planLabel = isTrialPlan(organization.pricingPlan) ? "Trial" : "Plan";
  const basePlan = getBasePricingPlan(organization.pricingPlan);
  const featuresLabel = basePlan === PricingPlanEnum.Custom ? "your plan's" : basePlan;
  // The progress bar fills up over the reminder window, not the whole (unknown) plan duration.
  const elapsedDays = Math.max(0, PLAN_EXPIRATION_REMINDER_DAYS - daysLeft);

  return (
    <UpsellCard
      icon={<FieldTimeOutlined />}
      title={`${planLabel} ends in ${daysLeft} ${pluralize("day", daysLeft)}`}
      progressPercent={(elapsedDays / PLAN_EXPIRATION_REMINDER_DAYS) * 100}
      description={`Keep ${featuresLabel} features after ${dayjs(organization.paidUntil).format("D MMM")}.`}
      actionLabel="Extend Plan"
      onAction={() => UpgradePricingPlanModal.extendPricingPlan(modal, organization)}
    />
  );
}

function TeamUpgradeUpsellCard() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  return (
    <UpsellCard
      icon={<TeamOutlined />}
      title="Working with others?"
      description="Team adds collaborative annotation and project management."
      actionLabel="Upgrade to Team"
      onAction={() =>
        UpgradePricingPlanModal.upgradePricingPlan(organization, PricingPlanEnum.Team)
      }
    />
  );
}

function AiAddonUpsellCard({ includedCredits }: { includedCredits: number }) {
  return (
    <UpsellCard
      icon={<RobotOutlined />}
      title="Train your own AI models"
      description={`The AI Add-on includes GPU compute and ${includedCredits.toLocaleString("en-US")} credits.`}
      actionLabel="Get AI Add-on"
      onAction={() => UpgradePricingPlanModal.requestAiPlanUpgrade()}
    />
  );
}

export function OrganizationSidebarUpsell() {
  const upsell = useSidebarUpsell();
  switch (upsell?.kind) {
    case "planExpiring":
      return <PlanExpiringUpsellCard daysLeft={upsell.daysLeft} />;
    case "teamUpgrade":
      return <TeamUpgradeUpsellCard />;
    case "aiAddon":
      return <AiAddonUpsellCard includedCredits={upsell.includedCredits} />;
    default:
      return null;
  }
}

import { CrownOutlined, FieldTimeOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Flex, Typography, theme } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import type { APIOrganization } from "types/api_types";
import { useCanRequestUpgrades } from "./organization_hooks";
import {
  canBuyQuotaUpgrades,
  canExtendPricingPlan,
  canUpgradePricingPlan,
  formatPricingPlanName,
  getPlanEndLabel,
  hasPlanEndDate,
  hasPricingPlanExceededStorage,
  hasPricingPlanExpired,
  isPlanAboutToExpire,
  isTrialPlan,
  PRICING_PAGE_URL,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";

export function PlanExpirationCard({ organization }: { organization: APIOrganization }) {
  const { token } = theme.useToken();
  const canRequestUpgrades = useCanRequestUpgrades();

  if (!hasPlanEndDate(organization)) return null;

  const hasExpired = hasPricingPlanExpired(organization);
  const isUrgent = hasExpired || isPlanAboutToExpire(organization);
  const timeLeft = dayjs(organization.paidUntil).fromNow(true);
  const planName = formatPricingPlanName(organization.pricingPlan);
  const planNoun = isTrialPlan(organization.pricingPlan) ? "trial" : "plan";

  let statusText: React.ReactNode;
  if (hasExpired) {
    statusText = `Your ${planNoun} has ended. Extend it to restore all users and features.`;
  } else if (isUrgent) {
    statusText = `Your ${planNoun} ends in ${timeLeft}. Extend it to keep all users and features.`;
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
            {planName} · {getPlanEndLabel(organization)}{" "}
            <FormattedDate timestamp={organization.paidUntil} dateOnly />
          </Typography.Text>
          <Typography.Text type={isUrgent ? "warning" : "secondary"}>
            {statusText}{" "}
            <a href={PRICING_PAGE_URL} target="_blank" rel="noopener noreferrer">
              Compare all plans
            </a>
          </Typography.Text>
        </div>
        {canRequestUpgrades && canExtendPricingPlan(organization) ? (
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
  const canRequestUpgrades = useCanRequestUpgrades();

  const overLimitMessage =
    "Your organization is using more users or storage space than included in your current plan.";

  let message: React.ReactNode;
  let actionButton: React.ReactNode = null;
  if (hasPlanExpired) {
    message = "Your WEBKNOSSOS plan has expired. Extend it to restore all users and features.";
    actionButton = (
      <Button
        size="small"
        type="primary"
        onClick={() => UpgradePricingPlanModal.extendPricingPlan()}
      >
        Extend Plan Now
      </Button>
    );
  } else if (canUpgradePricingPlan(organization.pricingPlan)) {
    message = `${overLimitMessage} Upgrade now to avoid your account from being blocked.`;
    actionButton = (
      <Button
        size="small"
        type="primary"
        onClick={() => UpgradePricingPlanModal.upgradePricingPlan()}
      >
        Upgrade Now
      </Button>
    );
  } else if (canBuyQuotaUpgrades(organization.pricingPlan)) {
    // The backend only counts users towards the exceeded state, storage is checked here.
    const exceededQuotas: Array<"users" | "storage"> = hasPricingPlanExceededStorage(organization)
      ? ["users", "storage"]
      : ["users"];
    message = `${overLimitMessage} Add more to avoid your account from being blocked.`;
    actionButton = (
      <Button
        size="small"
        type="primary"
        onClick={() => UpgradePricingPlanModal.upgradeQuotas(exceededQuotas)}
      >
        Add Users or Storage
      </Button>
    );
  } else {
    // Open Source and Enterprise have no quotas to buy, their limits are negotiated individually.
    message = (
      <>
        {overLimitMessage} <a href="mailto:support@webknossos.org">Get in touch</a> to adjust your
        plan.
      </>
    );
  }

  return (
    <Alert
      showIcon
      type="error"
      title={message}
      action={canRequestUpgrades ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

export function PlanAboutToExceedAlert({ organization }: { organization: APIOrganization }) {
  const canRequestUpgrades = useCanRequestUpgrades();
  if (!isPlanAboutToExpire(organization)) return null;

  const actionButton = (
    <Button size="small" type="primary" onClick={() => UpgradePricingPlanModal.extendPricingPlan()}>
      Extend Plan Now
    </Button>
  );

  return (
    <Alert
      showIcon
      type="warning"
      title={`Your WEBKNOSSOS plan ends ${dayjs(organization.paidUntil).fromNow()}. Extend it to keep all users and features.`}
      action={canRequestUpgrades ? actionButton : null}
      style={{ marginBottom: 20 }}
    />
  );
}

import {
  CrownOutlined,
  DollarCircleOutlined,
  FieldTimeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Flex, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import dayjs from "dayjs";
import { formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import type React from "react";
import { useMemo } from "react";
import type { APICreditTransaction } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import {
  canUpgradePricingPlan,
  formatIncludedStorage,
  formatIncludedUsers,
  getDaysUntilPlanExpires,
  hasPricingPlanExpired,
  PLAN_EXPIRATION_REMINDER_DAYS,
  PricingPlanEnum,
} from "./pricing_plan_utils";
import UpgradePricingPlanModal from "./upgrade_plan_modal";
import { useCanRequestUpgrades } from "./use_can_request_upgrades";

const SPENDING_WINDOW_DAYS = 30;

const summaryBarStyle: React.CSSProperties = {
  background: "var(--ant-color-bg-container)",
  border: "1px solid var(--ant-color-border-secondary)",
  borderRadius: 6,
  marginBottom: 16,
};
const summaryCellStyle: React.CSSProperties = { padding: "20px 24px" };
const summaryValueStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700 };

type CreditSummary = {
  // null when the organization has no credit account.
  milliCreditBalance: number | null;
  milliCreditsSpent: number;
};

function useCreditSummary(transactions: APICreditTransaction[]): CreditSummary {
  const milliCreditBalance = useWkSelector(
    (state) => state.activeOrganization?.milliCreditBalance ?? null,
  );
  return useMemo(() => {
    const windowStart = dayjs().subtract(SPENDING_WINDOW_DAYS, "day").valueOf();
    // Job charges and their refunds both reference the paid job, so summing them yields the net spending.
    const netJobCreditChange = transactions
      .filter((transaction) => transaction.paidJob != null && transaction.createdAt >= windowStart)
      .reduce((sum, transaction) => sum + transaction.creditChange, 0);
    return { milliCreditBalance, milliCreditsSpent: Math.max(0, -netJobCreditChange) };
  }, [transactions, milliCreditBalance]);
}

function SummaryStat({
  label,
  children,
  hasDivider,
}: {
  label: string;
  children: React.ReactNode;
  hasDivider?: boolean;
}) {
  return (
    <div
      style={{
        ...summaryCellStyle,
        borderInlineEnd: hasDivider ? "1px solid var(--ant-color-border-secondary)" : undefined,
      }}
    >
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Flex gap={8} align="center" style={{ marginTop: 4 }}>
        {children}
      </Flex>
    </div>
  );
}

export function CreditActivitySummaryBar({
  transactions,
}: {
  transactions: APICreditTransaction[];
}) {
  const { milliCreditBalance, milliCreditsSpent } = useCreditSummary(transactions);
  const canRequestUpgrades = useCanRequestUpgrades();

  return (
    <div
      style={{
        ...summaryBarStyle,
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr)) auto",
        alignItems: "center",
      }}
    >
      <SummaryStat label="Balance" hasDivider>
        <DollarCircleOutlined style={{ fontSize: 18, color: "var(--ant-color-warning)" }} />
        <span style={summaryValueStyle}>
          {milliCreditBalance != null ? formatMilliCreditsString(milliCreditBalance) : "N/A"}
        </span>
        {milliCreditBalance != null && milliCreditBalance <= 0 ? (
          <Typography.Text type="warning" style={{ fontSize: 13 }}>
            Low
          </Typography.Text>
        ) : null}
      </SummaryStat>
      <SummaryStat label={`Spent, last ${SPENDING_WINDOW_DAYS} days`}>
        <span style={summaryValueStyle}>{formatMilliCreditsString(milliCreditsSpent)}</span>
      </SummaryStat>
      <div style={summaryCellStyle}>
        {canRequestUpgrades ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={UpgradePricingPlanModal.orderWebknossosCredits}
          >
            Buy credits
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PlanSummaryBar() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const daysLeft = getDaysUntilPlanExpires(organization);
  const canRequestUpgrades = useCanRequestUpgrades();
  const hasExpired = daysLeft != null && hasPricingPlanExpired(organization);
  const canExtend = daysLeft != null && organization.pricingPlan !== PricingPlanEnum.Personal;

  return (
    <Flex align="center" gap={16} style={{ ...summaryBarStyle, ...summaryCellStyle }}>
      <CrownOutlined style={{ fontSize: 18, color: "var(--ant-color-primary)" }} />
      <div style={{ flex: 1 }}>
        <Typography.Text strong>{organization.pricingPlan}</Typography.Text> ·{" "}
        {formatIncludedUsers(organization.includedUsers)}{" "}
        {pluralize("user", organization.includedUsers)} ·{" "}
        {formatIncludedStorage(organization.includedStorageBytes)} storage
        {daysLeft != null ? (
          <>
            {" "}
            · paid until <FormattedDate timestamp={organization.paidUntil} dateOnly />{" "}
            {hasExpired ? (
              <Typography.Text type="danger">(expired)</Typography.Text>
            ) : (
              <Typography.Text
                type={daysLeft <= PLAN_EXPIRATION_REMINDER_DAYS ? "warning" : "secondary"}
              >
                ({daysLeft} {pluralize("day", daysLeft)} left)
              </Typography.Text>
            )}
          </>
        ) : null}
      </div>
      {canRequestUpgrades && canUpgradePricingPlan(organization.pricingPlan) ? (
        <Button onClick={() => UpgradePricingPlanModal.upgradePricingPlan()}>Upgrade</Button>
      ) : null}
      {canRequestUpgrades && canExtend ? (
        <Button
          type="primary"
          icon={<FieldTimeOutlined />}
          onClick={() => UpgradePricingPlanModal.extendPricingPlan()}
        >
          Extend Now
        </Button>
      ) : null}
    </Flex>
  );
}

import { CheckOutlined } from "@ant-design/icons";
import { Avatar, Card, Flex, Typography, theme } from "antd";
import type React from "react";
import { useState } from "react";
import type { StepStatus } from "./job_requirements";

function StepBadge({ step, status }: { step: number; status: StepStatus }) {
  const { cssVar } = theme.useToken();

  // Only celebrate the transition to "done", not a section that is already done on mount.
  const [previousStatus, setPreviousStatus] = useState(status);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  if (status !== previousStatus) {
    setPreviousStatus(status);
    setShouldAnimate(status === "done");
  }

  const statusStyles: Record<StepStatus, React.CSSProperties> = {
    pending: {
      background: "transparent",
      border: `1px solid ${cssVar.colorPrimary}`,
      color: cssVar.colorPrimary,
    },
    done: { background: cssVar.colorPrimary },
    error: {
      background: cssVar.colorErrorBg,
      border: `1px solid ${cssVar.colorError}`,
      color: cssVar.colorError,
    },
  };

  return (
    <Avatar
      size="small"
      className={shouldAnimate ? "ai-job-step-badge-done" : undefined}
      icon={
        status === "done" ? (
          <CheckOutlined className={shouldAnimate ? "ai-job-step-check" : undefined} />
        ) : undefined
      }
      style={{ flex: "none", fontWeight: 600, ...statusStyles[status] }}
    >
      {status === "done" ? undefined : step}
    </Avatar>
  );
}

type JobSectionProps = {
  step: number;
  title: string;
  description: string;
  status: StepStatus;
  extra?: React.ReactNode;
  children: React.ReactNode;
};

/** A numbered step of an AI job form, showing whether its inputs are complete. */
export function JobSection({ step, title, description, status, extra, children }: JobSectionProps) {
  const { cssVar } = theme.useToken();
  return (
    <Card style={{ boxShadow: cssVar.boxShadowTertiary }}>
      <Flex gap="small" align="flex-start" style={{ marginBottom: 20 }}>
        <StepBadge step={step} status={status} />
        <Flex vertical flex={1}>
          <Typography.Text strong style={{ fontSize: cssVar.fontSizeLG, lineHeight: "24px" }}>
            {title}
          </Typography.Text>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </Flex>
        {extra}
      </Flex>
      {children}
    </Card>
  );
}

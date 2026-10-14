import { CheckCircleFilled } from "@ant-design/icons";
import { Button, Card, Divider, Flex, Typography, theme } from "antd";
import type React from "react";
import type { CSSProperties } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";

export const smallCapsStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

// Copy for the job-started card, captured when the job starts so that later edits to the form
// don't change it.
export type StartedJob = {
  title: string;
  description: string;
};

type JobStartedCardProps = StartedJob & {
  onStartAnotherJob: () => void;
  // Shown below a divider, e.g. a hint at what to do with the job's results.
  nextStep?: React.ReactNode;
};

function JobStartedEyebrow() {
  const { cssVar } = theme.useToken();
  return (
    <Flex align="center" gap="small">
      <CheckCircleFilled style={{ color: cssVar.colorSuccess }} />
      <Typography.Text type="secondary" style={smallCapsStyle}>
        Job started
      </Typography.Text>
    </Flex>
  );
}

/** Replaces the credit information in an AI job tab's sidebar once its job has started. */
export function JobStartedCard({
  title,
  description,
  onStartAnotherJob,
  nextStep,
}: JobStartedCardProps) {
  const { cssVar } = theme.useToken();
  const dispatch = useDispatch();
  return (
    <Card style={{ boxShadow: cssVar.boxShadowTertiary }}>
      <Flex vertical gap="small">
        <JobStartedEyebrow />
        <Typography.Title level={4} style={{ margin: 0, fontWeight: 500 }}>
          {title}
        </Typography.Title>
        {/* type="secondary" would resolve to the dimmer colorTextTertiary, see theme.ts. */}
        <Typography.Text style={{ color: cssVar.colorTextSecondary }}>
          {description}
        </Typography.Text>
      </Flex>
      <Flex vertical gap="small" style={{ marginTop: 20 }}>
        <Button type="primary" block href="/jobs" target="_blank" rel="noopener noreferrer">
          View processing jobs
        </Button>
        <Button block onClick={onStartAnotherJob}>
          Start another job
        </Button>
        <Button block onClick={() => dispatch(setAIJobDrawerStateAction("invisible"))}>
          Close
        </Button>
      </Flex>
      {nextStep != null ? (
        <>
          <Divider style={{ margin: "20px 0" }} />
          {nextStep}
        </>
      ) : null}
    </Card>
  );
}

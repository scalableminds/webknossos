import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Input, Progress, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  diagnose,
  type ExperimentStatus,
  type ExperimentSummary,
  summarizeExperiments,
} from "./device_debug_diagnosis";
import { EXPERIMENTS } from "./device_debug_experiments";
import {
  clearPreviousRecord,
  createRecord,
  loadPreviousRecord,
  type RunRecord,
  runExperiments,
  type StepResult,
} from "./device_debug_runner";

const { Title, Paragraph, Text } = Typography;

const AUTO_CONTINUE_DELAY_S = 5;

const STATUS_ICONS: Record<ExperimentStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined style={{ color: "#999" }} />,
  running: <LoadingOutlined style={{ color: "#1677ff" }} />,
  passed: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
  failed: <CloseCircleOutlined style={{ color: "#ff4d4f" }} />,
  crashed: <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />,
  blocked: <StopOutlined style={{ color: "#faad14" }} />,
  skipped: <MinusCircleOutlined style={{ color: "#999" }} />,
};

function StepItem({ step }: { step: StepResult }) {
  const meta = [
    step.durationMs != null ? `${step.durationMs} ms` : null,
    step.usedHeapMB != null ? `heap ${step.usedHeapMB} MB` : null,
  ].filter((part) => part != null);
  return (
    <div style={{ padding: "4px 0 4px 24px" }}>
      <Space align="start">
        {STATUS_ICONS[step.status]}
        <div>
          <Text strong={step.status === "running" || step.status === "crashed"}>
            Step {step.index}: {step.label}
          </Text>
          {meta.length > 0 && <Text type="secondary"> ({meta.join(", ")})</Text>}
          {step.error != null && (
            <pre style={{ whiteSpace: "pre-wrap", color: "#ff4d4f", margin: 0 }}>{step.error}</pre>
          )}
          {step.details != null && (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>{step.details}</pre>
          )}
        </div>
      </Space>
    </div>
  );
}

function ExperimentItem({ summary }: { summary: ExperimentSummary }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(128, 128, 128, 0.2)" }}>
      <details open={summary.status !== "passed"}>
        <summary style={{ cursor: "pointer" }}>
          {STATUS_ICONS[summary.status]} <Text strong>{summary.experiment.label}</Text>
        </summary>
        {summary.steps.map((step) => (
          <StepItem key={step.index} step={step} />
        ))}
      </details>
    </div>
  );
}

export default function DeviceDebugView() {
  const [record, setRecord] = useState<RunRecord | null>(loadPreviousRecord);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  // The run is continued automatically after the page was reopened during a run.
  const [autoContinueIn, setAutoContinueIn] = useState<number | null>(() =>
    record != null && record.finishedAt == null ? AUTO_CONTINUE_DELAY_S : null,
  );
  const abortRef = useRef(false);

  useEffect(() => {
    // Stop a running test when leaving the page.
    return () => {
      abortRef.current = true;
    };
  }, []);

  const run = async (runRecord: RunRecord) => {
    abortRef.current = false;
    setAutoContinueIn(null);
    setIsRunning(true);
    try {
      await runExperiments(
        EXPERIMENTS,
        runRecord,
        setRecord,
        setStatusText,
        () => abortRef.current,
      );
    } finally {
      setIsRunning(false);
    }
  };

  const continueRun = () => {
    if (record != null) run(structuredClone(record));
  };

  useEffect(() => {
    if (autoContinueIn == null) return;
    if (autoContinueIn === 0) {
      continueRun();
      return;
    }
    const timeout = setTimeout(() => setAutoContinueIn(autoContinueIn - 1), 1000);
    return () => clearTimeout(timeout);
  });

  const summaries = summarizeExperiments(record);
  const conclusions = record != null && record.steps.length > 0 ? diagnose(summaries) : [];
  const finishedExperimentCount = summaries.filter(
    (summary) => summary.status !== "pending" && summary.status !== "running",
  ).length;
  const hasRemainingExperiments = summaries.some(
    (summary) => summary.status === "pending" || summary.status === "blocked",
  );
  const crashedStep = record?.steps.find((step) => step.status === "crashed");
  const report = record != null ? JSON.stringify(record, null, 2) : "";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <Title level={3}>Device Debugging</Title>
      <Paragraph>
        This page runs the GPU operations of WEBKNOSSOS one by one to find out which of them crash
        on this device. Press Start and wait until all tests are done (about 1–2 minutes). If the
        page crashes, open it again. It continues automatically with the next test.
      </Paragraph>

      {autoContinueIn != null && !isRunning && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="The last run was interrupted"
          description={
            <Space orientation="vertical">
              <span>
                {crashedStep != null
                  ? `The page crashed during step ${crashedStep.index}: ${crashedStep.label}. `
                  : ""}
                Continuing with the next test in {autoContinueIn} s.
              </span>
              <Space wrap>
                <Button size="small" type="primary" onClick={continueRun}>
                  Continue now
                </Button>
                <Button size="small" onClick={() => setAutoContinueIn(null)}>
                  Cancel
                </Button>
              </Space>
            </Space>
          }
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          onClick={() => run(createRecord())}
          loading={isRunning}
          disabled={isRunning}
        >
          {isRunning ? "Running…" : record == null ? "Start" : "Start new run"}
        </Button>
        {!isRunning && hasRemainingExperiments && record != null && (
          <Button onClick={continueRun}>Continue</Button>
        )}
        <Button
          danger
          disabled={!isRunning}
          onClick={() => {
            abortRef.current = true;
          }}
        >
          Stop
        </Button>
        <Button
          disabled={isRunning || record == null}
          onClick={() => {
            clearPreviousRecord();
            setRecord(null);
            setAutoContinueIn(null);
          }}
        >
          Clear results
        </Button>
      </Space>

      {record != null && (
        <>
          <Progress
            percent={Math.round((100 * finishedExperimentCount) / EXPERIMENTS.length)}
            status={isRunning ? "active" : "normal"}
          />
          {statusText != null && <Text type="secondary">{statusText}</Text>}

          {conclusions.length > 0 && (
            <Card
              size="small"
              style={{ margin: "16px 0" }}
              title={hasRemainingExperiments ? "Diagnosis (preliminary)" : "Diagnosis"}
            >
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {conclusions.map((conclusion) => (
                  <li key={conclusion}>{conclusion}</li>
                ))}
              </ul>
            </Card>
          )}

          {record.events.length > 0 && (
            <Alert
              type="warning"
              style={{ marginBottom: 16 }}
              title="Events"
              description={
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{record.events.join("\n")}</pre>
              }
            />
          )}

          <Card
            size="small"
            title={`Run started at ${new Date(record.startedAt).toLocaleString()}`}
          >
            {summaries.map((summary) => (
              <ExperimentItem key={summary.experiment.id} summary={summary} />
            ))}
          </Card>

          {!isRunning && (
            <Collapse
              style={{ marginTop: 16 }}
              items={[
                {
                  key: "report",
                  label: "Report (JSON)",
                  children: (
                    <Space orientation="vertical" style={{ width: "100%" }}>
                      <Button onClick={() => navigator.clipboard?.writeText(report)}>
                        Copy to clipboard
                      </Button>
                      <Input.TextArea
                        value={report}
                        readOnly
                        autoSize={{ minRows: 4, maxRows: 20 }}
                      />
                    </Space>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}

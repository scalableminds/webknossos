import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Descriptions,
  Input,
  InputNumber,
  Progress,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import type { ElementClass } from "types/api_types";
import {
  clearPreviousRecord,
  DEFAULT_CONFIG,
  type DebugConfig,
  loadConfig,
  loadPreviousRecord,
  type RunRecord,
  runDebugSteps,
  STEP_GROUPS,
  type StepResult,
  type StepStatus,
  storeConfig,
} from "./device_debug_steps";

const { Title, Paragraph, Text } = Typography;

const COLOR_ELEMENT_CLASSES: ElementClass[] = ["uint8", "uint16", "uint24", "float"];
const SEGMENTATION_ELEMENT_CLASSES: Array<ElementClass | "none"> = ["none", "uint32", "uint64"];

const STATUS_ICONS: Record<StepStatus, React.ReactNode> = {
  running: <LoadingOutlined style={{ color: "#1677ff" }} />,
  passed: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
  failed: <CloseCircleOutlined style={{ color: "#ff4d4f" }} />,
  crashed: <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />,
  skipped: <MinusCircleOutlined style={{ color: "#999" }} />,
};

function StepItem({ step }: { step: StepResult }) {
  const meta = [
    step.durationMs != null ? `${step.durationMs} ms` : null,
    step.usedHeapMB != null ? `heap ${step.usedHeapMB} MB` : null,
  ].filter((part) => part != null);
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(128, 128, 128, 0.2)" }}>
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

function ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: DebugConfig;
  onChange: (config: DebugConfig) => void;
  disabled: boolean;
}) {
  const update = (partial: Partial<DebugConfig>) => onChange({ ...config, ...partial });
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="GPU memory factor">
          <InputNumber
            min={1}
            max={16}
            value={config.gpuMemoryFactor}
            onChange={(value) => update({ gpuMemoryFactor: value ?? 1 })}
            disabled={disabled}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Color layers">
          <Space wrap>
            <InputNumber
              min={0}
              max={8}
              value={config.colorLayerCount}
              onChange={(value) => update({ colorLayerCount: value ?? 0 })}
              disabled={disabled}
            />
            <Select
              value={config.colorElementClass}
              options={COLOR_ELEMENT_CLASSES.map((value) => ({ value, label: value }))}
              onChange={(colorElementClass) => update({ colorElementClass })}
              disabled={disabled}
              style={{ width: 100 }}
            />
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="Segmentation layer">
          <Select
            value={config.segmentationElementClass}
            options={SEGMENTATION_ELEMENT_CLASSES.map((value) => ({ value, label: value }))}
            onChange={(segmentationElementClass) => update({ segmentationElementClass })}
            disabled={disabled}
            style={{ width: 100 }}
          />
        </Descriptions.Item>
        <Descriptions.Item label="JS memory limit (MB)">
          <InputNumber
            min={64}
            step={64}
            value={config.jsMemoryLimitMB}
            onChange={(value) => update({ jsMemoryLimitMB: value ?? 64 })}
            disabled={disabled}
          />
        </Descriptions.Item>
        <Descriptions.Item label="GPU stress limit (MB)">
          <InputNumber
            min={64}
            step={64}
            value={config.gpuStressLimitMB}
            onChange={(value) => update({ gpuStressLimitMB: value ?? 64 })}
            disabled={disabled}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Delay per step (ms)">
          <InputNumber
            min={0}
            step={100}
            value={config.delayMs}
            onChange={(value) => update({ delayMs: value ?? 0 })}
            disabled={disabled}
          />
        </Descriptions.Item>
      </Descriptions>
      <Text strong>Enabled step groups</Text>
      <Checkbox.Group
        style={{ display: "flex", flexDirection: "column" }}
        value={STEP_GROUPS.map(({ id }) => id).filter((id) => !config.disabledGroups.includes(id))}
        options={STEP_GROUPS.map(({ id, label }) => ({ value: id, label }))}
        onChange={(enabledGroups) =>
          update({
            disabledGroups: STEP_GROUPS.map(({ id }) => id).filter(
              (id) => !enabledGroups.includes(id),
            ),
          })
        }
        disabled={disabled}
      />
      <Button size="small" onClick={() => onChange(DEFAULT_CONFIG)} disabled={disabled}>
        Reset to defaults
      </Button>
    </Space>
  );
}

export default function DeviceDebugView() {
  const [config, setConfig] = useState<DebugConfig>(loadConfig);
  const [previousRecord] = useState(loadPreviousRecord);
  const [record, setRecord] = useState<RunRecord | null>(previousRecord);
  const [isRunning, setIsRunning] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    // Stop a running test when leaving the page.
    return () => {
      abortRef.current = true;
    };
  }, []);

  const onChangeConfig = (newConfig: DebugConfig) => {
    setConfig(newConfig);
    storeConfig(newConfig);
  };

  const start = async () => {
    if (canvasRef.current == null) return;
    abortRef.current = false;
    setIsRunning(true);
    try {
      await runDebugSteps(config, canvasRef.current, setRecord, () => abortRef.current);
    } finally {
      setIsRunning(false);
    }
  };

  const crashedStep = previousRecord?.steps.find((step) => step.status === "crashed");
  const failedSteps = record?.steps.filter((step) => step.status === "failed") ?? [];
  const runningStep = record?.steps.find((step) => step.status === "running");
  // The number of steps is only known while running, so the progress is based on the groups.
  const currentGroupIndex = STEP_GROUPS.findIndex(({ id }) => id === record?.steps.at(-1)?.group);
  const report = record != null ? JSON.stringify(record, null, 2) : "";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <Title level={3}>Device Debugging</Title>
      <Paragraph>
        This page runs the GPU and memory operations that WEBKNOSSOS performs when opening a
        dataset, one step at a time. The progress is saved after each step. If the page crashes,
        reopen it to see which step was running at that time.
      </Paragraph>

      {previousRecord?.crashed && record === previousRecord && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          title="The previous run did not finish"
          description={
            <>
              {crashedStep != null
                ? `The page crashed (or was closed) during step ${crashedStep.index}: ${crashedStep.label}.`
                : "The page crashed (or was closed) between two steps."}{" "}
              The run was started at {new Date(previousRecord.startedAt).toLocaleString()}. To test
              the remaining steps, disable the step group of the crashed step below and start again.
            </>
          }
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={start} loading={isRunning}>
          {isRunning ? "Running…" : "Start"}
        </Button>
        <Button
          danger
          disabled={!isRunning}
          onClick={() => {
            abortRef.current = true;
          }}
        >
          Abort
        </Button>
        <Button
          disabled={isRunning || record == null}
          onClick={() => {
            clearPreviousRecord();
            setRecord(null);
          }}
        >
          Clear results
        </Button>
      </Space>

      <Collapse
        style={{ marginBottom: 16 }}
        items={[
          {
            key: "config",
            label: "Settings",
            children: <ConfigForm config={config} onChange={onChangeConfig} disabled={isRunning} />,
          },
        ]}
      />

      {/* The renderer of WEBKNOSSOS is created for the canvas with this id. */}
      <canvas
        id="render-canvas"
        ref={canvasRef}
        style={{ width: "100%", maxWidth: 376, height: 200, display: "block", marginBottom: 16 }}
      />

      {record != null && (
        <Card
          size="small"
          title={
            <Space orientation="vertical" size={0} style={{ padding: "8px 0" }}>
              <span>
                Run started at {new Date(record.startedAt).toLocaleString()}
                {record.aborted ? " (aborted)" : ""}
              </span>
              {isRunning && runningStep != null && (
                <Text type="secondary">Running step {runningStep.index}…</Text>
              )}
              {!isRunning && record.finishedAt != null && (
                <Text type={failedSteps.length > 0 ? "danger" : "success"}>
                  {failedSteps.length > 0
                    ? `${failedSteps.length} step(s) failed`
                    : record.crashed
                      ? "Crashed"
                      : "All executed steps passed"}
                </Text>
              )}
            </Space>
          }
        >
          {isRunning && (
            <Progress
              percent={Math.round((100 * Math.max(0, currentGroupIndex)) / STEP_GROUPS.length)}
              status="active"
              showInfo={false}
            />
          )}
          {record.events.length > 0 && (
            <Alert
              type="warning"
              style={{ marginBottom: 8 }}
              title="Events"
              description={
                <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{record.events.join("\n")}</pre>
              }
            />
          )}
          {record.steps.map((step) => (
            <StepItem key={step.index} step={step} />
          ))}
        </Card>
      )}

      {record != null && !isRunning && (
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
                  <Input.TextArea value={report} readOnly autoSize={{ minRows: 4, maxRows: 20 }} />
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

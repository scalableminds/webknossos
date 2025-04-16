import { SyncOutlined } from "@ant-design/icons";
import { getVoxelyticsLogs } from "admin/admin_rest_api";
import Ansi from "ansi-to-react";
import { Button, Select, Switch, message } from "antd";
import chalk from "chalk";
import classnames from "classnames";
import { usePolling } from "libs/react_hooks";
import { LOG_LEVELS } from "oxalis/constants";
import { useMemo, useState } from "react";
import type { VoxelyticsLogLine } from "types/api_flow_types";
import { type Result, VX_POLLING_INTERVAL, addAfterPadding, addBeforePadding } from "./utils";

type LogResult = Result<Array<VoxelyticsLogLine>>;

// These constants need to be in sync with the variables in main.less
const LOG_LINE_LIMIT = 1000;

export function formatLog(
  logEntry: VoxelyticsLogLine,
  options: { timestamps: boolean; pid: boolean; level: boolean; logger: boolean },
): string {
  chalk.level = 3;
  const parts = [];
  if (options.timestamps) {
    parts.push(chalk.green(new Date(logEntry.timestamp).toISOString()));
  }
  if (options.pid) {
    parts.push(chalk.gray(`PID=${String(logEntry.pid).padStart(5, "0")}`));
  }
  if (options.level) {
    parts.push(chalk.bold.gray(logEntry.level.padEnd(8, " ")));
  }
  if (options.logger) {
    parts.push(chalk.magenta(logEntry.logger_name));
  }
  parts.push(logEntry.message);

  return parts.join(" ");
}

function LogContent({ logText }: { logText: Array<string> }) {
  return (
    <div className="log-content">
      {logText.map((_line, index) => (
        <div className={`log-line log-line-${index % 2 ? "odd" : "even"}`} key={index}>
          <div className="log-line-number">{index + 1}</div>
          <Ansi linkify>{logText[index]}</Ansi>
        </div>
      ))}
    </div>
  );
}

export default function LogTab({
  workflowHash,
  runId,
  taskName,
  isRunning,
  beginTime,
  endTime,
}: {
  workflowHash: string;
  runId: string;
  taskName: string;
  isRunning: boolean;
  beginTime: Date | null;
  endTime: Date | null;
}) {
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [level, setLevel] = useState(LOG_LEVELS.INFO);

  const [logResult, setLogResult] = useState<LogResult>({ type: "LOADING" });

  async function loadLog() {
    setIsLoading(true);
    try {
      const log =
        beginTime == null
          ? []
          : await getVoxelyticsLogs(
              runId,
              taskName,
              level,
              addBeforePadding(beginTime),
              addAfterPadding(endTime ?? new Date()),
              LOG_LINE_LIMIT,
            );
      setLogResult({ type: "SUCCESS", value: log });
    } catch {
      setLogResult({ type: "ERROR" });
    } finally {
      setIsLoading(false);
    }
  }

  usePolling(loadLog, isRunning ? VX_POLLING_INTERVAL : null, [runId, taskName, level]);

  const logText = useMemo(() => {
    switch (logResult.type) {
      case "LOADING":
        return ["Loading..."];
      case "ERROR":
        return ["Could not load log data."];
      case "SUCCESS":
        return logResult.value.length === 0
          ? ["Empty."]
          : logResult.value.map((line: any) =>
              formatLog(line, {
                timestamps: showTimestamps,
                pid: false,
                level: true,
                logger: true,
              }),
            );
      default:
        return [];
    }
  }, [logResult, showTimestamps]);

  async function downloadFullLog() {
    try {
      if (beginTime == null) {
        message.error("Run hasn't started yet.");
        return;
      }
      const logText = (
        await getVoxelyticsLogs(
          runId,
          taskName,
          level,
          addBeforePadding(beginTime),
          addAfterPadding(endTime ?? new Date()),
        )
      )
        .map((line: any) =>
          formatLog(line, { timestamps: true, pid: true, level: true, logger: true }),
        )
        .join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([logText], { type: "plain/text" }));
      a.download = `${workflowHash}_${runId}_${taskName}.log`;
      a.click();
    } catch (_error) {
      message.error("Could not fetch log for download.");
    }
  }

  return (
    <div className={classnames("log-tab", { "log-tab-fullscreen": isFullscreen })}>
      <div className="log-tab-header">
        <span style={{ marginRight: 16 }}>
          <Switch
            checked={showTimestamps}
            size="small"
            onChange={(checked: boolean) => {
              setShowTimestamps(checked);
            }}
          />{" "}
          Show Timestamps
        </span>

        <span style={{ marginRight: 16 }}>
          <Switch
            checked={isFullscreen}
            size="small"
            onChange={(checked: boolean) => {
              setIsFullscreen(checked);
            }}
          />{" "}
          Fullscreen
        </span>
        <Button onClick={() => loadLog()}>
          <SyncOutlined spin={isLoading} /> Refresh
        </Button>
        <Button onClick={downloadFullLog}>Download</Button>
        <Select onChange={(value) => setLevel(value)} value={level} style={{ marginLeft: -1 }}>
          {Object.values(LOG_LEVELS).map((_level) => (
            <Select.Option value={_level} key={_level}>
              {_level}
            </Select.Option>
          ))}
        </Select>
      </div>
      {logText.length >= LOG_LINE_LIMIT && (
        <p className="log-tab-warning">
          Only the {LOG_LINE_LIMIT} latest log lines are shown.{" "}
          <a
            onClick={(event) => {
              event.preventDefault();
              downloadFullLog();
            }}
          >
            Click download
          </a>{" "}
          for the full log.
        </p>
      )}
      <LogContent logText={logText} />
    </div>
  );
}

import React, { useMemo, useState } from "react";
import { Button, Select, Switch } from "antd";
import useResizeObserver from "use-resize-observer";
import ReactAnsi from "react-ansi";
import chalk from "chalk";
import usePolling from "libs/polling";
import { SyncOutlined } from "@ant-design/icons";
import { getVoxelyticsLogs } from "admin/admin_rest_api";
import { VX_POLLING_INTERVAL } from "./workflow_view";
import { Result } from "./task_view";

type LogResult = Result<Array<any>>;

const LOG_LEVELS = ["NOTSET", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];

export function formatLog(
  logEntry: any,
  options: { timestamps: boolean; pid: boolean; level: boolean; logger: boolean },
): string {
  chalk.level = 3;
  const parts = [];
  if (options.timestamps) {
    parts.push(chalk.green(logEntry._source["@timestamp"]));
  }
  if (options.pid) {
    parts.push(chalk.gray(`PID=${String(logEntry._source.pid).padStart(5, "0")}`));
  }
  if (options.level) {
    parts.push(chalk.bold.gray(logEntry._source.level.padEnd(8, " ")));
  }
  if (options.logger) {
    parts.push(chalk.magenta(logEntry._source.vx.logger_name));
  }
  parts.push(logEntry._source.message);

  return parts.join(" ");
}

function LogContent({ logText, height }: { logText: Array<string>; height: string | number }) {
  return <ReactAnsi log={logText} logStyle={{ height, fontSize: 12 }} autoScroll />;
}

export default function LogTab({
  runId,
  taskName,
  isRunning,
}: {
  runId: string;
  taskName: string;
  isRunning: boolean;
}) {
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [level, setLevel] = useState("DEBUG");

  const [logResult, setLogResult] = useState<LogResult>({ type: "LOADING" });

  const { ref: logContainerRef, height: logHeight = 0 } = useResizeObserver<HTMLDivElement>();

  async function loadLog() {
    setIsLoading(true);
    try {
      const log = await getVoxelyticsLogs(runId, taskName, level);
      setLogResult({ type: "SUCCESS", value: log });
    } catch {
      setLogResult({ type: "ERROR" });
    } finally {
      setIsLoading(false);
    }
  }

  usePolling(loadLog, isRunning ? VX_POLLING_INTERVAL : null);

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...(isFullscreen
          ? {
              position: "fixed",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 1001,
              background: "white",
              paddingTop: 8,
            }
          : {}),
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "end",
          alignItems: "center",
          marginBottom: 8,
          paddingRight: isFullscreen ? 8 : undefined,
        }}
      >
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

        <Select onChange={(value) => setLevel(value)} value={level} style={{ marginLeft: -1 }}>
          {LOG_LEVELS.map((_level) => (
            <Select.Option value={_level} key={_level}>
              {_level}
            </Select.Option>
          ))}
        </Select>
      </div>
      <div
        ref={logContainerRef}
        style={{
          width: "100%",
          height: isFullscreen ? undefined : 500,
          flex: isFullscreen ? 1 : undefined,
          position: "relative",
        }}
      >
        {logHeight > 0 && <LogContent logText={logText} height={logHeight} />}
      </div>
    </div>
  );
}

import React, { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "lodash";
import { Button, message, Select, Switch } from "antd";
import chalk from "chalk";
import Ansi from "ansi-to-react";
import classnames from "classnames";
import stripAnsi from "strip-ansi";
import { AutoSizer, List } from "react-virtualized";
import { usePolling } from "libs/react_hooks";
import { SyncOutlined } from "@ant-design/icons";
import { getVoxelyticsLogs } from "admin/admin_rest_api";
import { loadAllLogs, Result, VX_POLLING_INTERVAL } from "./utils";
import { VoxelyticsLogLine } from "types/api_flow_types";
import { LOG_LEVELS } from "oxalis/constants";

type LogResult = Result<Array<VoxelyticsLogLine>>;

// These constants need to be in sync with the variables in main.less
const LOG_FONT = "12px 'RobotoMono', Monaco, 'Courier New', monospace";
const LOG_LINE_HEIGHT = 19;
const LOG_LINE_NUMBER_WIDTH = 60;
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

function findBreakableCharFromRight(str: string, position: number): number {
  for (let i = position; i >= 0; --i) {
    const char = str[i];
    if (char.trim() === "" || char === "-") {
      return i;
    }
  }
  return -1;
}

function getLineCount(str: string, wrapLength: number): number {
  // Inspired by https://stackoverflow.com/a/857770
  let trimmedStr = str.trim();
  let counter = 1;
  while (trimmedStr.length > wrapLength) {
    let splitIdx = findBreakableCharFromRight(trimmedStr, wrapLength);
    if (splitIdx < 1) {
      splitIdx = wrapLength;
    }
    trimmedStr = trimmedStr.substring(splitIdx).trim();
    counter++;
  }
  return counter;
}

function LogContent({
  logText,
  width,
  height,
}: {
  logText: Array<string>;
  width: number;
  height: number;
}) {
  const listRef = useRef<List | null>(null);
  const debouncedRecomputeRowHeights = useRef(
    debounce(() => listRef.current?.recomputeRowHeights()),
  );

  const charWidth = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx == null) {
      throw new Error("Could not create measuring canvas");
    }
    ctx.font = LOG_FONT;
    const measurement = ctx.measureText("0123456789abcdefghijklmnopqrstuvwxyz");
    return measurement.width / 36;
  }, []);

  const lineCounts = useMemo(
    () =>
      logText.map((line) => {
        if (width - LOG_LINE_NUMBER_WIDTH < charWidth) {
          return 0;
        }
        const strippedLine = stripAnsi(line).trim();
        const lineCount = strippedLine
          .split("\n")
          .reduce(
            (r, a) => r + getLineCount(a, Math.floor((width - LOG_LINE_NUMBER_WIDTH) / charWidth)),
            0,
          );
        return lineCount;
      }),
    [logText, width],
  );

  function renderRow({ index, key, style }: { index: number; key: string; style: CSSProperties }) {
    return (
      <div className={`log-line log-line-${index % 2 ? "odd" : "even"}`} key={key} style={style}>
        <div className="log-line-number">{index + 1}</div>
        <Ansi linkify>{logText[index]}</Ansi>
      </div>
    );
  }

  useEffect(() => {
    debouncedRecomputeRowHeights.current();
  }, [width, logText]);

  return (
    <List
      ref={listRef}
      className="log-content"
      height={height}
      width={width}
      overscanRowCount={50}
      rowCount={logText.length}
      rowHeight={({ index }) => lineCounts[index] * LOG_LINE_HEIGHT}
      rowRenderer={renderRow}
    />
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
      const log = await getVoxelyticsLogs(
        runId,
        taskName,
        level,
        beginTime ?? new Date(0),
        endTime ?? new Date(),
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
      const logText = (
        await loadAllLogs(runId, taskName, level, beginTime ?? new Date(0), endTime ?? new Date())
      )
        .map((line: any) =>
          formatLog(line, { timestamps: true, pid: true, level: true, logger: true }),
        )
        .join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([logText], { type: "plain/text" }));
      a.download = `${workflowHash}_${runId}_${taskName}.log`;
      a.click();
    } catch (error) {
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
      <div className="log-tab-content">
        <AutoSizer>
          {({ height, width }) => <LogContent logText={logText} height={height} width={width} />}
        </AutoSizer>
      </div>
    </div>
  );
}

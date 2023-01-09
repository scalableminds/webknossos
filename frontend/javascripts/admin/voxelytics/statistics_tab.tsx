import React, { useState } from "react";
import { Button, Tooltip } from "antd";
import { SyncOutlined } from "@ant-design/icons";
import { getVoxelyticsChunkStatistics } from "admin/admin_rest_api";
import { usePolling } from "libs/react_hooks";
import {
  formatBytes,
  formatCPU,
  formatDistanceStrict,
  formatDurationStrict,
} from "libs/format_utils";
import { VoxelyticsChunkStatistics } from "types/api_flow_types";
import { Result, VX_POLLING_INTERVAL } from "./utils";
import moment from "moment";

type StatisticsResult = Result<Array<VoxelyticsChunkStatistics>>;

function parseStatistics(row: VoxelyticsChunkStatistics): VoxelyticsChunkStatistics {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key === "executionId") {
        return [key, value];
      } else if (value == null) {
        return [key, null];
      } else if (key === "beginTime" || key === "endTime") {
        return [key, new Date(value as string)];
      } else {
        return [key, value];
      }
    }),
  ) as VoxelyticsChunkStatistics;
}

export default function StatisticsTab({
  workflowHash,
  runId,
  taskName,
  isRunning,
}: {
  workflowHash: string;
  runId: string | null;
  taskName: string;
  isRunning: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [statisticsResult, setStatisticsResult] = useState<StatisticsResult>({ type: "LOADING" });

  async function loadStatistics() {
    try {
      setIsLoading(true);
      const statistics = (await getVoxelyticsChunkStatistics(workflowHash, runId, taskName)).map(
        parseStatistics,
      );
      setStatisticsResult({
        type: "SUCCESS",
        value: statistics,
      });
    } catch {
      setStatisticsResult({ type: "ERROR" });
    } finally {
      setIsLoading(false);
    }
  }

  usePolling(loadStatistics, isRunning ? VX_POLLING_INTERVAL : null, [runId, taskName]);

  function renderContent() {
    if (statisticsResult.type === "LOADING") {
      return <p>Loading...</p>;
    }
    if (statisticsResult.type === "ERROR") {
      return <p>Could not load statistics.</p>;
    }

    if (statisticsResult.value.length === 0) {
      return <p>No data.</p>;
    }
    return (
      <table className="stats-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th>Execution Id</th>
            <th>Memory</th>
            <th>CPU User</th>
            <th>CPU System</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {statisticsResult.value.map((row: VoxelyticsChunkStatistics) => (
            <tr key={row.executionId}>
              <td>
                <Tooltip
                  overlay={
                    <>
                      {row.counts.complete}/{row.counts.total - row.counts.skipped} complete,{" "}
                      {row.counts.cancelled} cancelled, {row.counts.failed} failed,{" "}
                      {row.counts.skipped} skipped
                    </>
                  }
                >
                  <span>
                    {row.executionId}
                    <br />
                    <span className="stats-label">
                      {row.counts.complete !== row.counts.total - row.counts.skipped && (
                        <>{row.counts.complete} of </>
                      )}
                      {row.counts.total - row.counts.skipped} chunk
                      {row.counts.total - row.counts.skipped !== 1 && "s"} completed
                    </span>
                  </span>
                </Tooltip>
              </td>
              <td>
                {row.memory?.max != null && (
                  <>
                    <span className="stats-label">Max</span>{" "}
                    {formatBytes(row.memory.max * 1024 * 1024)}
                  </>
                )}
                <br />
                {row.memory?.median != null && (
                  <>
                    <span className="stats-label">Median</span>{" "}
                    {formatBytes(row.memory.median * 1024 * 1024)}
                  </>
                )}
                <br />
                {row.memory?.stddev != null && (
                  <>
                    <span className="stats-label">Stddev</span>{" "}
                    {formatBytes(row.memory.stddev * 1024 * 1024)}
                  </>
                )}
              </td>
              <td>
                {row.cpuUser?.max != null && (
                  <>
                    <span className="stats-label">Max</span> {formatCPU(row.cpuUser.max)}
                  </>
                )}
                <br />
                {row.cpuUser?.median != null && (
                  <>
                    <span className="stats-label">Median</span> {formatCPU(row.cpuUser.median)}
                  </>
                )}
                <br />
                {row.cpuUser?.stddev != null && (
                  <>
                    <span className="stats-label">Stddev</span> {formatCPU(row.cpuUser.stddev)}
                  </>
                )}
              </td>
              <td>
                {row.cpuSystem?.max != null && (
                  <>
                    <span className="stats-label">Max</span> {formatCPU(row.cpuSystem.max)}
                  </>
                )}
                <br />
                {row.cpuSystem?.median != null && (
                  <>
                    <span className="stats-label">Median</span> {formatCPU(row.cpuSystem.median)}
                  </>
                )}
                <br />
                {row.cpuSystem?.stddev != null && (
                  <>
                    <span className="stats-label">Stddev</span> {formatCPU(row.cpuSystem.stddev)}
                  </>
                )}
              </td>
              <td>
                {row.counts.total === 1 ? (
                  row.duration?.max != null && (
                    <>
                      <span className="stats-label">Sum</span>{" "}
                      {formatDistanceStrict(row.duration.max * 1000, 0)}
                    </>
                  )
                ) : (
                  <>
                    {row.duration?.max != null && (
                      <>
                        <span className="stats-label">Max</span>{" "}
                        {formatDistanceStrict(row.duration.max * 1000, 0)}
                      </>
                    )}
                    <br />
                    {row.duration?.median != null && (
                      <>
                        <span className="stats-label">Median</span>{" "}
                        {formatDistanceStrict(row.duration.median * 1000, 0)}
                      </>
                    )}
                    <br />{" "}
                    {row.duration?.sum != null && (
                      <>
                        <span className="stats-label">Sum</span>{" "}
                        {formatDistanceStrict(row.duration.sum * 1000, 0)}
                      </>
                    )}
                  </>
                )}
                <br />
                {row.wallTime != null && (
                  <>
                    <span className="stats-label">Wall</span>{" "}
                    {formatDurationStrict(moment.duration(row.wallTime, "seconds"))}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "end",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <Button onClick={() => loadStatistics()}>
          <SyncOutlined spin={isLoading} /> Refresh
        </Button>
      </div>
      {renderContent()}
    </>
  );
}

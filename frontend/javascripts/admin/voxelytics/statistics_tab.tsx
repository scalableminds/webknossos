import { useState } from "react";
import { Button, Tooltip } from "antd";
import { SyncOutlined } from "@ant-design/icons";
import { getVoxelyticsChunkStatistics } from "admin/admin_rest_api";
import { usePolling } from "libs/react_hooks";
import {
  formatCountToDataAmountUnit,
  formatCPU,
  formatTimeIntervalStrict,
  formatDurationStrict,
  formatNumber,
} from "libs/format_utils";
import type { VoxelyticsChunkStatistics } from "types/api_flow_types";
import type { Result } from "./utils";
import dayjs from "dayjs";
import { pluralize } from "libs/utils";

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

  usePolling(loadStatistics, null, [runId, taskName]);

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
          {statisticsResult.value.map((row: VoxelyticsChunkStatistics) => {
            const remainingCount =
              row.chunkCounts.total -
              row.chunkCounts.complete -
              row.chunkCounts.failed -
              row.chunkCounts.cancelled -
              row.chunkCounts.skipped;
            const runnableCount = row.chunkCounts.total - row.chunkCounts.skipped;
            return (
              <tr key={row.executionId}>
                <td>
                  <Tooltip
                    overlay={
                      <>
                        {formatNumber(remainingCount)} remaining •{" "}
                        {formatNumber(row.chunkCounts.complete)} complete •{" "}
                        {formatNumber(row.chunkCounts.cancelled)} cancelled •{" "}
                        {formatNumber(row.chunkCounts.failed)} failed •{" "}
                        {formatNumber(row.chunkCounts.skipped)} skipped •{" "}
                        {formatNumber(row.chunkCounts.total)} total
                      </>
                    }
                  >
                    <span>
                      {row.executionId}
                      <br />
                      <span className="stats-label">
                        {row.chunkCounts.complete !== runnableCount && (
                          <>{formatNumber(row.chunkCounts.complete)} of </>
                        )}
                        {formatNumber(runnableCount)} {pluralize("chunk", runnableCount)} completed
                      </span>
                    </span>
                  </Tooltip>
                </td>
                <td>
                  {row.memory?.max != null && (
                    <>
                      <span className="stats-label">Max</span>{" "}
                      {formatCountToDataAmountUnit(row.memory.max * 1024 * 1024)}
                    </>
                  )}
                  <br />
                  {row.memory?.median != null && (
                    <>
                      <span className="stats-label">Median</span>{" "}
                      {formatCountToDataAmountUnit(row.memory.median * 1024 * 1024)}
                    </>
                  )}
                  <br />
                  {row.memory?.stddev != null && (
                    <>
                      <span className="stats-label">Stddev</span>{" "}
                      {formatCountToDataAmountUnit(row.memory.stddev * 1024 * 1024)}
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
                  {row.chunkCounts.total === 1 ? (
                    row.duration?.max != null && (
                      <>
                        <span className="stats-label">Sum</span>{" "}
                        {formatTimeIntervalStrict(row.duration.max * 1000, 0)}
                      </>
                    )
                  ) : (
                    <>
                      {row.duration?.max != null && (
                        <>
                          <span className="stats-label">Max</span>{" "}
                          {formatTimeIntervalStrict(row.duration.max * 1000, 0)}
                        </>
                      )}
                      <br />
                      {row.duration?.median != null && (
                        <>
                          <span className="stats-label">Median</span>{" "}
                          {formatTimeIntervalStrict(row.duration.median * 1000, 0)}
                        </>
                      )}
                      <br />{" "}
                      {row.duration?.sum != null && (
                        <>
                          <span className="stats-label">Sum</span>{" "}
                          {formatTimeIntervalStrict(row.duration.sum * 1000, 0)}
                        </>
                      )}
                    </>
                  )}
                  <br />
                  {row.wallTime != null && (
                    <>
                      <span className="stats-label">Wall</span>{" "}
                      {formatDurationStrict(dayjs.duration(row.wallTime, "seconds"))}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
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

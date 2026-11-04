import { SyncOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getVoxelyticsChunkStatistics } from "admin/rest_api";
import { Button, Flex, Tooltip } from "antd";
import {
  formatCountToDataAmountUnit,
  formatCPU,
  formatDuration,
  formatNumber,
} from "libs/format_utils";
import { pluralize } from "libs/utils";
import type { VoxelyticsChunkStatistics } from "types/api_types";
import { parseStatistics } from "./parse_api_data";

export default function StatisticsTab({
  workflowHash,
  runId,
  taskName,
}: {
  workflowHash: string;
  runId: string | null;
  taskName: string;
}) {
  // Errors are shown inline instead of as a toast, so plain useQuery is used here.
  const {
    data: statistics,
    status,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["voxelyticsChunkStatistics", workflowHash, runId, taskName],
    queryFn: async () =>
      (await getVoxelyticsChunkStatistics(workflowHash, runId, taskName)).map(parseStatistics),
    retry: false,
    refetchOnWindowFocus: false,
    meta: { persist: false },
  });

  function renderContent() {
    if (status === "pending") {
      return <p>Loading...</p>;
    }
    if (status === "error") {
      return <p>Could not load statistics.</p>;
    }

    if (statistics.length === 0) {
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
          {statistics.map((row: VoxelyticsChunkStatistics) => {
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
                        {formatDuration(row.duration.max * 1000)}
                      </>
                    )
                  ) : (
                    <>
                      {row.duration?.max != null && (
                        <>
                          <span className="stats-label">Max</span>{" "}
                          {formatDuration(row.duration.max * 1000)}
                        </>
                      )}
                      <br />
                      {row.duration?.median != null && (
                        <>
                          <span className="stats-label">Median</span>{" "}
                          {formatDuration(row.duration.median * 1000)}
                        </>
                      )}
                      <br />{" "}
                      {row.duration?.sum != null && (
                        <>
                          <span className="stats-label">Sum</span>{" "}
                          {formatDuration(row.duration.sum * 1000)}
                        </>
                      )}
                    </>
                  )}
                  <br />
                  {row.wallTime != null && (
                    <>
                      <span className="stats-label">Wall</span>{" "}
                      {formatDuration(row.wallTime * 1000)}
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
      <Flex
        justify="end"
        align="center"
        style={{
          marginBottom: 8,
        }}
      >
        <Button onClick={() => refetch()} icon={<SyncOutlined spin={isFetching} />}>
          Refresh
        </Button>
      </Flex>
      {renderContent()}
    </>
  );
}

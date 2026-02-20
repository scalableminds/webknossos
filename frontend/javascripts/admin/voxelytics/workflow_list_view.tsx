import { SyncOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { useQuery } from "@tanstack/react-query";
import { getVoxelyticsWorkflows } from "admin/rest_api";
import { Button, Flex, Input, Progress, Space, Spin, Table, Tooltip } from "antd";
import { formatCountToDataAmountUnit, formatDateMedium, formatNumber } from "libs/format_utils";
import Persistence from "libs/persistence";
import Toast from "libs/toast";
import { filterWithSearchQueryAND } from "libs/utils";
import type React from "react";
import { type Key, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  VoxelyticsRunState,
  type VoxelyticsWorkflowListing,
  type VoxelyticsWorkflowListingRun,
} from "types/api_types";
import { runStateToStatus, VX_POLLING_INTERVAL } from "./utils";

const { Search } = Input;

const persistence = new Persistence<Pick<{ searchQuery: string }, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "workflowList",
);

function parseRunInfo(runInfo: VoxelyticsWorkflowListingRun) {
  return {
    ...runInfo,
    beginTime: runInfo.beginTime != null ? new Date(runInfo.beginTime) : null,
    endTime: runInfo.endTime != null ? new Date(runInfo.endTime) : null,
  };
}

function parseWorkflowInfo(workflowInfo: VoxelyticsWorkflowListing): VoxelyticsWorkflowListing {
  return {
    ...workflowInfo,
    runs: workflowInfo.runs.map(parseRunInfo).sort((a, b) => {
      if (a.beginTime != null && b.beginTime != null)
        return a.beginTime.getTime() - b.beginTime.getTime();
      else if (a.beginTime != null) return -1;
      else if (b.beginTime != null) return 1;
      else return 0;
    }),
  };
}

function uniqueify<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

type RenderRunInfo = Omit<VoxelyticsWorkflowListingRun, "userFirstName" | "userLastName"> & {
  workflowName: string;
  workflowHash: string;
  userDisplayName: string | undefined;
  children?: Array<VoxelyticsWorkflowListingRun>;
};

export default function WorkflowListView() {
  const [searchQuery, setSearchQuery] = useState("");

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  const {
    data: workflows = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["voxelyticsWorkflows"],
    queryFn: async () => {
      try {
        return await getVoxelyticsWorkflows();
      } catch (err) {
        Toast.error("Could not load workflow list.");
        console.error(err);
        throw err;
      }
    },
    // We use the select to transform the data because it is run on cached and fetched data
    select: (data) => data.map(parseWorkflowInfo),
    refetchInterval: VX_POLLING_INTERVAL ?? false,
  });

  const getUserDisplayName = (run: VoxelyticsWorkflowListingRun) => {
    return run.userFirstName != null || run.userLastName != null
      ? [run.userFirstName, run.userLastName].join(" ").trim()
      : run.hostUserName;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies(getUserDisplayName): omitted to maintain stability as the function does not capture reactive state
  const renderRuns: Array<RenderRunInfo> = useMemo(
    () =>
      workflows.map((workflow) => ({
        workflowName: workflow.name,
        workflowHash: workflow.hash,
        state: workflow.state,
        beginTime: workflow.runs[0].beginTime,
        endTime: workflow.runs[0].endTime,
        name: "",
        id: "", // used to distinguish between workflows and runs when rendering
        hostUserName: uniqueify(workflow.runs.map((run) => run.hostUserName)).join(", "),
        hostName: uniqueify(workflow.runs.map((run) => run.hostName)).join(", "),
        userDisplayName: uniqueify(workflow.runs.map((run) => getUserDisplayName(run))).join(", "),
        voxelyticsVersion: uniqueify(workflow.runs.map((run) => run.voxelyticsVersion)).join(", "),
        taskCounts: workflow.taskCounts,
        children: workflow.runs.map((run) => ({
          workflowName: workflow.name,
          workflowHash: workflow.hash,
          userDisplayName: getUserDisplayName(run),
          ...run,
        })),
      })),
    [workflows],
  );

  function renderProgress(run: RenderRunInfo) {
    let label = "";
    if (run.state === VoxelyticsRunState.RUNNING) {
      const remainingCount =
        run.taskCounts.total -
        run.taskCounts.complete -
        run.taskCounts.failed -
        run.taskCounts.cancelled -
        run.taskCounts.skipped;
      label += `${remainingCount} remaining • `;
    }
    label += `${run.taskCounts.complete} complete`;
    if (run.taskCounts.cancelled > 0) {
      label += ` • ${run.taskCounts.cancelled} cancelled`;
    }
    if (run.taskCounts.failed > 0) {
      label += ` • ${run.taskCounts.failed} failed`;
    }
    if (run.taskCounts.skipped > 0) {
      label += ` • ${run.taskCounts.skipped} skipped`;
    }
    label += ` • ${run.taskCounts.total} total`;
    if (run.state === VoxelyticsRunState.STALE) {
      label += " • timeout";
    }

    return (
      <Tooltip title={label}>
        <Progress
          percent={Math.round(
            ((run.taskCounts.complete + run.taskCounts.cancelled + run.taskCounts.failed) /
              run.taskCounts.total) *
              100,
          )}
          status={runStateToStatus(run.state)}
          success={{ percent: Math.round((run.taskCounts.complete / run.taskCounts.total) * 100) }}
          size="small"
        />
      </Tooltip>
    );
  }

  return (
    <div className="container voxelytics-view">
      <Flex justify="space-between" align="baseline" style={{ marginBottom: 20 }}>
        <h3>Voxelytics Workflows</h3>
        <Space>
          <Button onClick={() => refetch()}>
            <SyncOutlined spin={isFetching} /> Refresh
          </Button>
          <Search
            style={{
              width: 200,
            }}
            onChange={handleSearch}
            value={searchQuery}
          />
        </Space>
      </Flex>
      <Spin spinning={isLoading} size="large">
        <Table
          bordered
          rowKey={(run: RenderRunInfo) => `${run.id}-${run.workflowHash}`}
          pagination={{ pageSize: 100 }}
          columns={[
            {
              title: "Workflow",
              key: "workflow",
              render: (run: RenderRunInfo) =>
                run.id === "" ? (
                  <Link to={`/workflows/${run.workflowHash}`}>
                    {run.workflowName} ({run.workflowHash})
                  </Link>
                ) : (
                  <Link to={`/workflows/${run.workflowHash}?runId=${encodeURIComponent(run.id)}`}>
                    {run.name}
                  </Link>
                ),
            },
            {
              title: "User",
              key: "userName",
              dataIndex: "userDisplayName",
              filters: uniqueify(renderRuns.map((run) => run.userDisplayName)).map((username) => ({
                text: username || "",
                value: username || "",
              })),
              onFilter: (value: Key | boolean, run: RenderRunInfo) =>
                run.userDisplayName?.startsWith(String(value)) || false,
              filterSearch: true,
            },
            {
              title: "Host",
              dataIndex: "hostName",
              key: "host",
              filters: uniqueify(renderRuns.map((run) => run.hostName)).map((hostname) => ({
                text: hostname,
                value: hostname,
              })),
              onFilter: (value: Key | boolean, run: RenderRunInfo) =>
                run.hostName.startsWith(String(value)),
              filterSearch: true,
            },
            {
              title: "Progress",
              key: "progress",
              width: 200,
              render: renderProgress,
            },
            {
              title: "File Size",
              key: "fileSize",
              width: 200,
              render: (run: RenderRunInfo) => (
                <Tooltip
                  overlay={
                    <>
                      {formatCountToDataAmountUnit(run.taskCounts.fileSize)} •{" "}
                      {formatNumber(run.taskCounts.inodeCount)} inodes
                      <br />
                      Note: manual changes on disk are not reflected here
                    </>
                  }
                >
                  {formatCountToDataAmountUnit(run.taskCounts.fileSize)}
                </Tooltip>
              ),
              sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
                a.taskCounts.fileSize - b.taskCounts.fileSize,
            },
            {
              title: "Begin",
              key: "begin",
              defaultSortOrder: "descend",
              sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
                (a.beginTime?.getTime() ?? Number.POSITIVE_INFINITY) -
                (b.beginTime?.getTime() ?? Number.POSITIVE_INFINITY),
              render: (run: RenderRunInfo) => run.beginTime && formatDateMedium(run.beginTime),
            },
            {
              title: "End",
              key: "end",
              sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
                (a.endTime?.getTime() ?? Number.POSITIVE_INFINITY) -
                (b.endTime?.getTime() ?? Number.POSITIVE_INFINITY),
              render: (run: RenderRunInfo) => run.endTime && formatDateMedium(run.endTime),
            },
          ]}
          dataSource={filterWithSearchQueryAND(renderRuns, ["workflowName"], searchQuery)}
          locale={{ emptyText: null }}
        />
      </Spin>
    </div>
  );
}

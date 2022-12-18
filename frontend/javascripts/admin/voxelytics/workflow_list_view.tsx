import React, { useMemo, useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { Table, Progress, Tooltip, Button } from "antd";
import { Link } from "react-router-dom";
import { getVoxelyticsWorkflows } from "admin/admin_rest_api";
import {
  VoxelyticsWorkflowListingRun,
  VoxelyticsRunState,
  VoxelyticsTaskInfo,
  VoxelyticsWorkflowListing,
} from "types/api_flow_types";
import { usePolling } from "libs/react_hooks";
import { formatDateMedium } from "libs/format_utils";
import Toast from "libs/toast";
import { VX_POLLING_INTERVAL } from "./workflow_view";

function parseRunInfo(runInfo: VoxelyticsWorkflowListingRun): VoxelyticsWorkflowListingRun {
  return {
    ...runInfo,
    beginTime: new Date(runInfo.beginTime),
    endTime: runInfo.endTime != null ? new Date(runInfo.endTime) : null,
  } as any as VoxelyticsWorkflowListingRun;
}

function parseWorkflowInfo(workflowInfo: VoxelyticsWorkflowListing): VoxelyticsWorkflowListing {
  return {
    ...workflowInfo,
    runs: workflowInfo.runs.map(parseRunInfo).sort((a, b) => b.beginTime - a.beginTime),
  };
}

function uniqueify<T>(array: Array<T>): Array<T> {
  return [...new Set(array)];
}

type RenderRunInfo = VoxelyticsWorkflowListingRun & {
  workflowName: string;
  workflowHash: string;
  children?: Array<VoxelyticsWorkflowListingRun>;
};

export default function WorkflowListView() {
  const [isLoading, setIsLoading] = useState(false);
  const [workflows, setWorkflows] = useState<Array<VoxelyticsWorkflowListing>>([]);

  async function loadData() {
    setIsLoading(true);
    try {
      const _workflows = (await getVoxelyticsWorkflows()).map(parseWorkflowInfo);
      setWorkflows(_workflows);
    } catch (err) {
      console.error(err);
      Toast.error("Could not load workflow list.");
    } finally {
      setIsLoading(false);
    }
  }

  usePolling(loadData, VX_POLLING_INTERVAL);

  const renderRuns = useMemo(
    () =>
      workflows.map((workflow) => ({
        workflowName: workflow.name,
        workflowHash: workflow.hash,
        state: workflow.state,
        beginTime: workflow.runs[0].beginTime,
        endTime: workflow.runs[0].endTime,
        name: "",
        id: "", // used to distinguish between workflows and runs when rendering
        username: uniqueify(workflow.runs.map((run) => run.username)).join(", "),
        hostname: uniqueify(workflow.runs.map((run) => run.hostname)).join(", "),
        voxelyticsVersion: uniqueify(workflow.runs.map((run) => run.voxelyticsVersion)).join(", "),
        taskStatistics: workflow.taskStatistics,
        children: workflow.runs.map((run) => ({
          workflowName: workflow.name,
          workflowHash: workflow.hash,
          ...run,
        })),
      })),
    [workflows],
  ) as any as Array<RenderRunInfo>;

  function renderProgress(run: RenderRunInfo) {
    const skippedCount = run.taskStatistics.skipped;
    const completeCount = run.taskStatistics.complete;
    const cancelledCount = run.taskStatistics.cancelled;
    const failedCount = run.taskStatistics.failed;
    const runnableCount = run.taskStatistics.total - run.taskStatistics.skipped;
    let label = `${completeCount}/${runnableCount} complete`;
    if (cancelledCount > 0) {
      label += `, ${cancelledCount} cancelled`;
    }
    if (failedCount > 0) {
      label += `, ${failedCount} failed`;
    }
    if (skippedCount > 0) {
      label += `, ${skippedCount} skipped`;
    }
    if (run.state === VoxelyticsRunState.STALE) {
      label += ", timeout";
    }

    return (
      <Tooltip title={label}>
        <Progress
          percent={Math.round(((completeCount + failedCount) / runnableCount) * 100)}
          status={runStateToStatus(run.state)}
          success={{ percent: Math.round((completeCount / runnableCount) * 100) }}
          size="small"
        />
      </Tooltip>
    );
  }

  function runStateToStatus(state: VoxelyticsRunState) {
    switch (state) {
      case VoxelyticsRunState.COMPLETE:
        return "success";
      case VoxelyticsRunState.STALE:
      case VoxelyticsRunState.FAILED:
      case VoxelyticsRunState.CANCELLED:
        return "exception";
      case VoxelyticsRunState.PENDING:
        return "active";
      default:
        return "normal";
    }
  }

  return (
    <div className="container voxelytics-view">
      <div className="pull-right">
        <Button onClick={() => loadData()}>
          <SyncOutlined spin={isLoading} /> Refresh
        </Button>
      </div>
      <h3>Voxelytics Workflows</h3>
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
            dataIndex: "username",
            key: "user",
            filters: uniqueify(renderRuns.map((run) => run.username)).map((username) => ({
              text: username,
              value: username,
            })),
            onFilter: (value: string | number | boolean, run: RenderRunInfo) =>
              run.username.startsWith(String(value)),
            filterSearch: true,
          },
          {
            title: "Hostname",
            dataIndex: "hostname",
            key: "hostname",
            filters: uniqueify(renderRuns.map((run) => run.hostname)).map((hostname) => ({
              text: hostname,
              value: hostname,
            })),
            onFilter: (value: string | number | boolean, run: RenderRunInfo) =>
              run.hostname.startsWith(String(value)),
            filterSearch: true,
          },
          {
            title: "Progress",
            key: "progress",
            width: 200,
            render: renderProgress,
          },
          {
            title: "Begin",
            key: "begin",
            defaultSortOrder: "descend",
            sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
              (a.beginTime ?? Infinity) - (b.beginTime ?? Infinity),
            render: (run: RenderRunInfo) => run.beginTime && formatDateMedium(run.beginTime),
          },
          {
            title: "End",
            key: "end",
            sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
              (a.endTime ?? Infinity) - (b.endTime ?? Infinity),
            render: (run: RenderRunInfo) => run.endTime && formatDateMedium(run.endTime),
          },
        ]}
        dataSource={renderRuns}
      />
    </div>
  );
}

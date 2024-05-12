import React, { useMemo, useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { Table, Progress, Tooltip, Button } from "antd";
import { Link } from "react-router-dom";
import { getVoxelyticsWorkflows } from "admin/admin_rest_api";
import {
  VoxelyticsWorkflowListingRun,
  VoxelyticsRunState,
  VoxelyticsWorkflowListing,
} from "types/api_flow_types";
import { usePolling } from "libs/react_hooks";
import { formatCountToDataAmountUnit, formatDateMedium, formatNumber } from "libs/format_utils";
import Toast from "libs/toast";
import { runStateToStatus, VX_POLLING_INTERVAL } from "./utils";

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
    runs: workflowInfo.runs
      .map(parseRunInfo)
      .sort((a, b) => b.beginTime.getTime() - a.beginTime.getTime()),
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
      Toast.error("Could not load workflow list.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  usePolling(loadData, VX_POLLING_INTERVAL);

  // todo fix state enum typing
  const renderRuns: Array<RenderRunInfo> = useMemo(
    () =>
      workflows.map((workflow) => ({
        workflowName: workflow.name,
        workflowHash: workflow.hash,
        state: VoxelyticsRunState[workflow.state],
        beginTime: workflow.runs[0].beginTime,
        endTime: workflow.runs[0].endTime,
        name: "",
        id: "", // used to distinguish between workflows and runs when rendering
        username: uniqueify(workflow.runs.map((run) => run.username)).join(", "),
        hostname: uniqueify(workflow.runs.map((run) => run.hostname)).join(", "),
        userFirstName: uniqueify(workflow.runs.map((run) => run.userFirstName)).join(", "),
        userLastName: uniqueify(workflow.runs.map((run) => run.userLastName)).join(", "),
        voxelyticsVersion: uniqueify(workflow.runs.map((run) => run.voxelyticsVersion)).join(", "),
        taskCounts: workflow.taskCounts,
        children: workflow.runs.map((run) => ({
          workflowName: workflow.name,
          workflowHash: workflow.hash,
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
            title: "First Name",
            dataIndex: "userFirstName",
            key: "userFirstName",
          },
          {
            title: "Last Name",
            dataIndex: "userLastName",
            key: "userLastName",
          },
          {
            title: "Host User",
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
              (a.beginTime?.getTime() ?? Infinity) - (b.beginTime?.getTime() ?? Infinity),
            render: (run: RenderRunInfo) => run.beginTime && formatDateMedium(run.beginTime),
          },
          {
            title: "End",
            key: "end",
            sorter: (a: RenderRunInfo, b: RenderRunInfo) =>
              (a.endTime?.getTime() ?? Infinity) - (b.endTime?.getTime() ?? Infinity),
            render: (run: RenderRunInfo) => run.endTime && formatDateMedium(run.endTime),
          },
        ]}
        dataSource={renderRuns}
      />
    </div>
  );
}

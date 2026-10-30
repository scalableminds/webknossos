import { ExportOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import dayjs from "dayjs";
import { formatDateMedium, formatDuration, formatTimeInterval } from "libs/format_utils";
import { useUpdateEvery } from "libs/react_hooks";
import { Link } from "react-router";
import {
  type VoxelyticsArtifactConfig,
  VoxelyticsRunState,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsTaskInfo,
} from "types/api_types";
import { colorHasher } from "./dag_view";
import RunStateTag from "./run_state_tag";

function TaskStateTag({ taskInfo }: { taskInfo: VoxelyticsTaskInfo }) {
  // Re-render every 10s so that the durations that are relative to the current time
  // are updated regularly.
  useUpdateEvery(10000);
  switch (taskInfo.state) {
    case VoxelyticsRunState.PENDING:
      return <RunStateTag state={VoxelyticsRunState.PENDING} />;
    case VoxelyticsRunState.SKIPPED:
      return <RunStateTag state={VoxelyticsRunState.SKIPPED} />;
    case VoxelyticsRunState.RUNNING: {
      const currentDuration = Date.now() - taskInfo.beginTime.getTime();
      if (taskInfo.chunkCounts.complete > 0) {
        const estimatedRemainingDuration =
          (currentDuration /
            (taskInfo.chunkCounts.complete +
              taskInfo.chunkCounts.failed +
              taskInfo.chunkCounts.cancelled)) *
            (taskInfo.chunkCounts.total - taskInfo.chunkCounts.skipped) -
          currentDuration;
        const estimatedEndTime = new Date(Date.now() + estimatedRemainingDuration);
        return (
          <Tooltip
            title={
              <>
                Begin Time: {formatDateMedium(taskInfo.beginTime)}
                <br />
                Current Duration: {formatDuration(currentDuration)}
                <br />
                Estimated Remaining Duration: {formatDuration(estimatedRemainingDuration)}
                <br />
                Estimated End Time: {formatDateMedium(estimatedEndTime)}
              </>
            }
          >
            <RunStateTag state={VoxelyticsRunState.RUNNING} />
            started {dayjs(taskInfo.beginTime).fromNow()}, probably finishes{" "}
            {dayjs(estimatedEndTime).fromNow()}
          </Tooltip>
        );
      } else {
        return (
          <Tooltip
            title={
              <>
                Begin Time: {formatDateMedium(taskInfo.beginTime)}
                <br />
                Current Duration: {formatDuration(currentDuration)}
              </>
            }
          >
            <RunStateTag state={VoxelyticsRunState.RUNNING} />
            started {dayjs(taskInfo.beginTime).fromNow()}
          </Tooltip>
        );
      }
    }
    case VoxelyticsRunState.STALE:
      return (
        <Tooltip
          title={
            <>
              Begin Time: {formatDateMedium(taskInfo.beginTime)}
              <br />
              Last Heartbeat: {formatDateMedium(taskInfo.endTime)}
            </>
          }
        >
          <RunStateTag state={VoxelyticsRunState.STALE} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.CANCELLED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
            </>
          }
        >
          <RunStateTag state={VoxelyticsRunState.CANCELLED} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.FAILED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
            </>
          }
        >
          <RunStateTag state={VoxelyticsRunState.FAILED} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.COMPLETE:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
            </>
          }
        >
          <RunStateTag state={VoxelyticsRunState.COMPLETE} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeInterval(taskInfo.beginTime, taskInfo.endTime)}
        </Tooltip>
      );
    default:
      return null;
  }
}

export function MetaTaskPanelLabel({
  metaTaskKey,
  taskInfo,
}: {
  metaTaskKey: string;
  taskInfo: VoxelyticsTaskInfo;
}) {
  return (
    <div className="task-panel-header">
      <div
        style={{
          width: 10,
          height: 10,
          display: "inline-block",
          marginRight: 20,
          borderRadius: "50%",
          backgroundColor: "gray",
          boxShadow: "5px 0px 0 0px #478d98, 10px 0px 0 0px #73e471",
        }}
      />
      {metaTaskKey}
      <wbr />
      <span className="task-panel-state">
        <TaskStateTag taskInfo={taskInfo} />
      </span>
    </div>
  );
}

export function TaskPanelLabel({
  task,
  taskInfo,
  foreignWorkflow,
}: {
  task: VoxelyticsTaskConfigWithName;
  taskInfo: VoxelyticsTaskInfo;
  // [workflowHash, runId] of the workflow that produced the artifacts of a skipped task
  foreignWorkflow: [string, string] | null;
}) {
  return (
    <div className="task-panel-header">
      <div
        style={{
          borderRadius: "50%",
          height: 10,
          width: 10,
          display: "inline-block",
          marginRight: 10,
          backgroundColor: colorHasher.hex(task.task),
        }}
      />
      {foreignWorkflow != null ? (
        <Link to={`/workflows/${foreignWorkflow[0]}/run/${encodeURIComponent(foreignWorkflow[1])}`}>
          {task.taskName}
          &nbsp;
          <ExportOutlined />
        </Link>
      ) : (
        task.taskName
      )}
      <wbr />
      {task.config.name != null && <span className="task-panel-name">{task.config.name}</span>}
      <wbr />
      <span className="task-panel-state">
        <TaskStateTag taskInfo={taskInfo} />
      </span>
    </div>
  );
}

function isWebknossosUrl(url: string) {
  try {
    const { hostname, host } = new URL(url);
    return (
      hostname === "webknossos.org" ||
      hostname.endsWith(".webknossos.org") ||
      host === window.location.host
    );
  } catch {
    return false;
  }
}

// Returns the first link of the task's output artifacts which points to WEBKNOSSOS.
export function getWebknossosLinkOfArtifacts(
  artifacts: Record<string, VoxelyticsArtifactConfig>,
): string | null {
  for (const artifact of Object.values(artifacts)) {
    const links = Object.values(artifact.metadata?.links ?? {});
    const webknossosLink = links.find(isWebknossosUrl);
    if (webknossosLink != null) {
      return webknossosLink;
    }
  }
  return null;
}

export function OpenInWebknossosButton({ url }: { url: string }) {
  return (
    <Button
      size="small"
      icon={<ExportOutlined />}
      href={url}
      target="_blank"
      rel="noreferrer"
      // Prevent the click from toggling the collapse panel.
      onClick={(event) => event.stopPropagation()}
    >
      Open in WEBKNOSSOS
    </Button>
  );
}

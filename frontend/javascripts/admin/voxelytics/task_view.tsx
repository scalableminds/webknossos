import { Progress, Tabs, type TabsProps, Tooltip } from "antd";
import { formatNumber } from "libs/format_utils";
import Markdown from "libs/markdown_adapter";
import { JSONTree, type LabelRenderer, type ShouldExpandNodeInitially } from "react-json-tree";
import {
  type VoxelyticsArtifactConfig,
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowDagEdge,
} from "types/api_flow_types";
import ArtifactsViewer from "./artifacts_view";
import LogTab from "./log_tab";
import StatisticsTab from "./statistics_tab";
import { runStateToStatus, useTheme } from "./utils";

const labelRenderer: LabelRenderer = function (_keyPath) {
  const keyPath = _keyPath.slice().reverse();
  return <div id={`label-${keyPath.join(".")}`}>{keyPath.slice(-1)[0]}</div>;
};

function TaskView({
  taskName,
  workflowHash,
  runId,
  task,
  artifacts,
  dag,
  taskInfo,
  onSelectTask,
}: {
  workflowHash: string;
  runId: string | null;
  taskName: string;
  task: VoxelyticsTaskConfig;
  artifacts: Record<string, VoxelyticsArtifactConfig>;
  dag: { edges: Array<VoxelyticsWorkflowDagEdge> };
  taskInfo: VoxelyticsTaskInfo;
  onSelectTask: (id: string) => void;
}) {
  const shouldExpandNode: ShouldExpandNodeInitially = function (_keyPath, data) {
    // Expand all with at most 10 keys
    return ((data as any[]).length || 0) <= 10;
  };

  const ingoingEdges = dag.edges.filter((edge) => edge.target === taskName);
  const [theme, invertTheme] = useTheme();

  const configTab = (
    <>
      <p>
        Class: <span style={{ fontFamily: "monospace" }}>{task.task}</span>
      </p>
      <JSONTree
        data={task.config}
        hideRoot
        shouldExpandNodeInitially={shouldExpandNode}
        labelRenderer={labelRenderer}
        theme={theme}
        invertTheme={invertTheme}
      />
    </>
  );

  const logTab =
    runId != null ? (
      <LogTab
        workflowHash={workflowHash}
        runId={runId}
        taskName={taskInfo.taskName}
        isRunning={taskInfo.state === VoxelyticsRunState.RUNNING}
        beginTime={taskInfo.beginTime}
        endTime={taskInfo.endTime}
      />
    ) : (
      <p>Please select a specific run.</p>
    );

  const tabs: TabsProps["items"] = [{ label: "Config", key: "1", children: configTab }];
  if (task.description != null)
    tabs.unshift({
      label: "Description",
      key: "0",
      children: <Markdown>{task.description}</Markdown>,
    });

  if (Object.keys(artifacts).length > 0)
    tabs.push({
      label: "Output Artifacts",
      key: "2",
      children: (
        <ArtifactsViewer
          workflowHash={workflowHash}
          runId={runId}
          taskName={taskName}
          artifacts={artifacts}
        />
      ),
    });

  if (Object.keys(task.inputs).length > 0)
    tabs.push({
      label: "Input Artifacts",
      key: "3",
      children: <ul>{renderInputs(task.inputs, ingoingEdges, onSelectTask)}</ul>,
    });

  if (
    [
      VoxelyticsRunState.COMPLETE,
      VoxelyticsRunState.RUNNING,
      VoxelyticsRunState.STALE,
      VoxelyticsRunState.FAILED,
      VoxelyticsRunState.CANCELLED,
    ].includes(taskInfo.state)
  ) {
    tabs.push({ label: "Logs", key: "4", children: logTab });
    tabs.push({
      label: "Statistics",
      key: "5",
      children: (
        <StatisticsTab
          workflowHash={workflowHash}
          runId={runId}
          taskName={taskInfo.taskName}
          isRunning={taskInfo.state === VoxelyticsRunState.RUNNING}
        />
      ),
    });
  }

  return (
    <div>
      {[
        VoxelyticsRunState.RUNNING,
        VoxelyticsRunState.CANCELLED,
        VoxelyticsRunState.FAILED,
        VoxelyticsRunState.STALE,
      ].includes(taskInfo.state) && (
        <div style={{ display: "flex", flexDirection: "row" }}>
          Chunk Progress:
          <Tooltip
            overlay={
              <>
                {formatNumber(
                  taskInfo.chunkCounts.total -
                    taskInfo.chunkCounts.complete -
                    taskInfo.chunkCounts.failed -
                    taskInfo.chunkCounts.cancelled -
                    taskInfo.chunkCounts.skipped,
                )}{" "}
                remaining • {formatNumber(taskInfo.chunkCounts.complete)} complete •{" "}
                {formatNumber(taskInfo.chunkCounts.cancelled)} cancelled •{" "}
                {formatNumber(taskInfo.chunkCounts.failed)} failed •{" "}
                {formatNumber(taskInfo.chunkCounts.skipped)} skipped •{" "}
                {formatNumber(taskInfo.chunkCounts.total)} total
              </>
            }
          >
            <span
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                marginLeft: "1em",
                marginRight: "3em",
              }}
            >
              <Progress
                percent={
                  ((taskInfo.chunkCounts.complete +
                    taskInfo.chunkCounts.cancelled +
                    taskInfo.chunkCounts.failed) /
                    (taskInfo.chunkCounts.total - taskInfo.chunkCounts.skipped)) *
                  100
                }
                status={runStateToStatus(taskInfo.state)}
                success={{
                  percent: Math.round(
                    (taskInfo.chunkCounts.complete /
                      (taskInfo.chunkCounts.total - taskInfo.chunkCounts.skipped)) *
                      100,
                  ),
                }}
                size="small"
                showInfo={false}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: "0.9em", marginLeft: "1em" }}>
                {formatNumber(taskInfo.chunkCounts.complete)} /{" "}
                {formatNumber(taskInfo.chunkCounts.total - taskInfo.chunkCounts.skipped)}
              </span>
            </span>
          </Tooltip>
          Current Execution ID:&nbsp;
          <span style={{ fontFamily: "monospace" }}>
            {taskInfo.currentExecutionId != null ? taskInfo.currentExecutionId : "-"}
          </span>
        </div>
      )}
      <Tabs defaultActiveKey="1" items={tabs} />
    </div>
  );
}

function renderInputs(
  inputs: Record<string, string | Record<string, string>>,
  ingoingEdges: Array<VoxelyticsWorkflowDagEdge>,
  onSelectTask: (id: string) => void,
  prevKeys: Array<string> = [],
) {
  // `inputs` may be a dictionary, if nested input structures were used.
  // Due to the potentially nested structure, we have to maintain the key chain
  // (`prevKeys`) and also check whether the current item is another dictionary
  // (in that case, renderInputs is called recursively).
  return Object.entries(inputs).map(([key, linkLabelOrDict]) => {
    const sourceTaskName = getTaskProducerOfInput(ingoingEdges, prevKeys.concat([key]));
    if (linkLabelOrDict == null) {
      return (
        <li key={key}>
          <b>{key}:</b> -
        </li>
      );
    } else if (typeof linkLabelOrDict === "string") {
      const linkLabel = linkLabelOrDict;
      return (
        <li key={key}>
          <b>{key}:</b>{" "}
          {sourceTaskName != null ? (
            <a
              href=""
              onClick={(ev) => {
                ev.preventDefault();
                onSelectTask(sourceTaskName);
              }}
            >
              {linkLabel}
            </a>
          ) : (
            <code>{linkLabel}</code>
          )}
        </li>
      );
    } else {
      return (
        <div key={key}>
          <li>
            <b>{key}:</b>{" "}
          </li>
          <div style={{ paddingLeft: 10 }}>
            {renderInputs(linkLabelOrDict, ingoingEdges, onSelectTask, prevKeys.concat([key]))}
          </div>
        </div>
      );
    }
  });
}

function getTaskProducerOfInput(
  ingoingEdges: Array<VoxelyticsWorkflowDagEdge>,
  inputKeys: Array<string>,
) {
  const inputLabel = inputKeys.join(".");
  const edge = ingoingEdges.find((_edge) => _edge.label === inputLabel);
  if (edge == null) {
    return null;
  }
  return edge.source;
}

export default TaskView;

import React from "react";
import { JSONTree } from "react-json-tree";
import { Progress, Tabs, Tooltip } from "antd";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import {
  VoxelyticsArtifactConfig,
  VoxelyticsRunState,
  VoxelyticsTaskConfig,
  VoxelyticsTaskInfo,
  VoxelyticsWorkflowDagEdge,
} from "types/api_flow_types";
import ArtifactsViewer from "./artifacts_view";
import LogTab from "./log_tab";
import StatisticsTab from "./statistics_tab";
import { useTheme } from "./utils";

const { TabPane } = Tabs;

function labelRenderer(_keyPath: Array<string | number>) {
  const keyPath = _keyPath.slice().reverse();
  const divWithId = <div id={`label-${keyPath.join(".")}`}>{keyPath.slice(-1)[0]}</div>;
  return divWithId;
}

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
  const shouldExpandNode = (keyPath: Array<string | number>, data: any) =>
    // Expand all with at most 10 keys
    (data.length || 0) <= 10;

  const ingoingEdges = dag.edges.filter((edge) => edge.target === taskName);
  const [theme, invertTheme] = useTheme();

  return (
    <div>
      {taskInfo.state === VoxelyticsRunState.RUNNING && (
        <div style={{ display: "flex", flexDirection: "row" }}>
          Approx. Chunk Progress:
          <Tooltip
            overlay={
              <>
                Finished chunks: {taskInfo.chunksFinished}, Total chunks: {taskInfo.chunksTotal}
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
                percent={(taskInfo.chunksFinished / taskInfo.chunksTotal) * 100}
                size="small"
                showInfo={false}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: "0.9em", marginLeft: "1em" }}>
                {taskInfo.chunksFinished} / {taskInfo.chunksTotal}
              </span>
            </span>
          </Tooltip>
          Current Execution Id:&nbsp;
          <span style={{ fontFamily: "monospace" }}>
            {taskInfo.currentExecutionId != null ? taskInfo.currentExecutionId : "-"}
          </span>
        </div>
      )}
      <Tabs defaultActiveKey="1">
        {task.description != null ? (
          <TabPane tab="Description" key="0">
            <Markdown
              source={task.description}
              options={{
                html: false,
                breaks: true,
                linkify: true,
              }}
            />
          </TabPane>
        ) : null}
        <TabPane tab="Config" key="1">
          <p>
            Class: <span style={{ fontFamily: "monospace" }}>{task.task}</span>
          </p>
          <JSONTree
            data={task.config}
            hideRoot
            shouldExpandNode={shouldExpandNode}
            labelRenderer={labelRenderer}
            theme={theme}
            invertTheme={invertTheme}
          />
        </TabPane>
        {Object.keys(artifacts).length > 0 ? (
          <TabPane tab="Output Artifacts" key="2">
            <ArtifactsViewer
              workflowHash={workflowHash}
              runId={runId}
              taskName={taskName}
              artifacts={artifacts}
            />
          </TabPane>
        ) : null}
        {Object.keys(task.inputs).length > 0 ? (
          <TabPane tab="Input Artifacts" key="3">
            <ul>{renderInputs(task.inputs, ingoingEdges, onSelectTask)}</ul>
          </TabPane>
        ) : null}
        {[
          VoxelyticsRunState.COMPLETE,
          VoxelyticsRunState.RUNNING,
          VoxelyticsRunState.STALE,
          VoxelyticsRunState.FAILED,
          VoxelyticsRunState.CANCELLED,
        ].includes(taskInfo.state) && (
          <TabPane tab="Logs" key="4">
            {runId != null ? (
              <LogTab
                workflowHash={workflowHash}
                runId={runId}
                taskName={taskInfo.taskName}
                isRunning={taskInfo.state === VoxelyticsRunState.RUNNING}
              />
            ) : (
              <p>Please select a specific run.</p>
            )}
          </TabPane>
        )}
        {[
          VoxelyticsRunState.COMPLETE,
          VoxelyticsRunState.RUNNING,
          VoxelyticsRunState.STALE,
          VoxelyticsRunState.FAILED,
          VoxelyticsRunState.CANCELLED,
        ].includes(taskInfo.state) && (
          <TabPane tab="Statistics" key="5">
            <StatisticsTab
              workflowHash={workflowHash}
              runId={runId}
              taskName={taskInfo.taskName}
              isRunning={taskInfo.state === VoxelyticsRunState.RUNNING}
            />
          </TabPane>
        )}
      </Tabs>
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
    if (typeof linkLabelOrDict === "string") {
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

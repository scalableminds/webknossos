/* eslint-disable jsx-a11y/anchor-is-valid */
import React from "react";
import { JSONTree } from "react-json-tree";
import { Progress, Tabs, Tooltip } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import ArtifactsViewer from "./artifacts_view";
import LogTab from "./log_tab";
import StatisticsTab from "./statistics_tab";

const { TabPane } = Tabs;

// https://github.com/reduxjs/redux-devtools/blob/75322b15ee7ba03fddf10ac3399881e302848874/src/react/themes/default.js
export const theme = {
  scheme: "default",
  author: "chris kempson (http://chriskempson.com)",
  base00: "#181818",
  base01: "#282828",
  base02: "#383838",
  base03: "#585858",
  base04: "#b8b8b8",
  base05: "#d8d8d8",
  base06: "#e8e8e8",
  base07: "#f8f8f8",
  base08: "#ab4642",
  base09: "#dc9656",
  base0A: "#f7ca88",
  base0B: "#a1b56c",
  base0C: "#86c1b9",
  base0D: "#7cafc2",
  base0E: "#ba8baf",
  base0F: "#a16946",
};

function TaskView({
  taskName,
  workflowHash,
  task,
  docs,
  artifacts,
  dag,
  taskInfo,
  onSelectTask,
}: {
  workflowHash: string;
  taskName: string;
  task: TaskConfig;
  docs: Record<string, Record<string, string>>;
  artifacts: Record<string, ArtifactConfig>;
  dag: { edges: Array<WorkflowDagEdge> };
  taskInfo: TaskInfo;
  onSelectTask: (id: string) => void;
}) {
  const shouldExpandNode = (keyPath: Array<string | number>, data: any, level: number) => {
    // Expand all with at most 10 keys
    return (data.length || 0) <= 10;
  };

  function labelRenderer(_keyPath: Array<string | number>, task: TaskConfig) {
    const keyPath = _keyPath.slice().reverse();
    const taskClass = task.task;

    const taskDocs = docs[taskClass] || {};
    const docString = taskDocs[keyPath.join(".")];

    const divWithId = (
      <div id={"label-" + keyPath.join(".")}>
        {keyPath.slice(-1)[0]}
        {docString != null && (
          <Tooltip title={docString} placement="left">
            <InfoCircleOutlined style={{ marginLeft: 10 }} />
          </Tooltip>
        )}
      </div>
    );
    return divWithId;
  }

  const ingoingEdges = dag.edges.filter((edge) => edge.target === taskName);

  return (
    <div>
      {taskInfo.state === RunState.RUNNING && (
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
            <ReactMarkdown children={task.description} />
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
            labelRenderer={(keyPath) => labelRenderer(keyPath, task)}
            theme={theme}
          />
        </TabPane>
        {Object.keys(artifacts).length > 0 ? (
          <TabPane tab="Output Artifacts" key="2">
            <ArtifactsViewer
              artifacts={artifacts}
              runId={taskInfo.runId}
              workflowHash={workflowHash}
              taskName={taskName}
            />
          </TabPane>
        ) : null}
        {Object.keys(task.inputs).length > 0 ? (
          <TabPane tab="Input Artifacts" key="3">
            <ul>{renderInputs(task.inputs, ingoingEdges, onSelectTask)}</ul>
          </TabPane>
        ) : null}
        {[
          RunState.COMPLETE,
          RunState.RUNNING,
          RunState.STALE,
          RunState.FAILED,
          RunState.CANCELLED,
        ].includes(taskInfo.state) && (
          <TabPane tab="Logs" key="4">
            <LogTab
              runId={taskInfo.runId}
              taskName={taskInfo.taskName}
              isRunning={taskInfo.state === RunState.RUNNING}
            />
          </TabPane>
        )}
        {[
          RunState.COMPLETE,
          RunState.RUNNING,
          RunState.STALE,
          RunState.FAILED,
          RunState.CANCELLED,
        ].includes(taskInfo.state) && (
          <TabPane tab="Statistics" key="5">
            <StatisticsTab
              workflowHash={workflowHash}
              runId={taskInfo.runId}
              taskName={taskInfo.taskName}
              isRunning={taskInfo.state === RunState.RUNNING}
            />
          </TabPane>
        )}
      </Tabs>
    </div>
  );
}

function renderInputs(
  inputs: Record<string, string | Record<string, string>>,
  ingoingEdges: Array<WorkflowDagEdge>,
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
            <code style={{ background: "#f7f7f7" }}>{linkLabel}</code>
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

function getTaskProducerOfInput(ingoingEdges: Array<WorkflowDagEdge>, inputKeys: Array<string>) {
  const inputLabel = inputKeys.join(".");
  const edge = ingoingEdges.find((edge) => edge.label === inputLabel);
  if (edge == null) {
    return null;
  }
  return edge.source;
}

export default TaskView;

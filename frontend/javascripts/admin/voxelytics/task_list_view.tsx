import React, { useEffect, useState, useMemo } from "react";
import {
  Collapse,
  Input,
  Row,
  Col,
  Menu,
  Button,
  Dropdown,
  notification,
  message,
  Tag,
  Tooltip,
} from "antd";
import {
  ClockCircleOutlined,
  MinusCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LeftOutlined,
} from "@ant-design/icons";
import MiniSearch from "minisearch";
import ColorHash from "color-hash";

import { Link, useLocation, useParams } from "react-router-dom";
import moment from "moment";
import { useUpdateEvery } from "libs/react_hooks";
import {
  VoxelyticsRunState,
  VoxelyticsTaskConfig,
  VoxelyticsTaskConfigWithHierarchy,
  VoxelyticsTaskConfigWithName,
  VoxelyticsTaskInfo,
  VoxelyticsWorkflowReport,
} from "types/api_flow_types";
import { getVoxelyticsLogs } from "admin/admin_rest_api";
import { formatDateMedium, formatDistance, formatDistanceStrict } from "libs/format_utils";
import DAGView from "./dag_view";
import TaskView from "./task_view";
import { formatLog } from "./log_tab";

const { Panel } = Collapse;
const { Search } = Input;

function getFilteredTasks(
  miniSearch: MiniSearch<any>,
  report: VoxelyticsWorkflowReport,
  searchString: string,
): Array<VoxelyticsTaskConfigWithName> {
  const allTasks: Array<VoxelyticsTaskConfigWithName> = Object.keys(report.config.tasks).map(
    (key) => ({
      ...report.config.tasks[key],
      taskName: key,
    }),
  );

  if (searchString.length > 0) {
    const results = miniSearch.search(searchString, {
      fuzzy: 0.2,
      prefix: true,
      combineWith: "AND",
    });
    const resultTaskNames = results.map((result) => result.id);
    return allTasks.filter((task) => resultTaskNames.includes(task.taskName));
  }

  return allTasks;
}

/**
 * Adapted from https://stackoverflow.com/questions/486896/adding-a-parameter-to-the-url-with-javascript
 * Add a URL parameter (or changing it if it already exists)
 */
function addUrlParam(location: ReturnType<typeof useLocation>, key: string, val: string) {
  const search = new URLSearchParams(location.search);
  search.append(key, val);
  return `${location.pathname}?${search.toString()}`;
}

function removeUrlParam(location: ReturnType<typeof useLocation>, key: string) {
  const search = new URLSearchParams(location.search);
  search.delete(key);
  return `${location.pathname}?${search.toString()}`;
}

function TaskStateTag({ taskInfo }: { taskInfo: VoxelyticsTaskInfo }) {
  // Re-render every 10s so that the durations that are relative to the current time
  // are updated regularly.
  useUpdateEvery(10000);
  switch (taskInfo.state) {
    case VoxelyticsRunState.PENDING:
      return (
        <Tag icon={<ClockCircleOutlined />} color="default">
          pending
        </Tag>
      );
    case VoxelyticsRunState.SKIPPED:
      return (
        <Tag icon={<MinusCircleOutlined />} color="default">
          skipped
        </Tag>
      );
    case VoxelyticsRunState.RUNNING:
      return (
        <Tooltip title={<>Begin Time: {formatDateMedium(taskInfo.beginTime)}</>}>
          <Tag icon={<SyncOutlined spin />} color="processing">
            running
          </Tag>
          started {moment(taskInfo.beginTime).fromNow()} ago
        </Tooltip>
      );
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
          <Tag icon={<CloseCircleOutlined />} color="error">
            timed out
          </Tag>{" "}
          {moment(taskInfo.endTime).fromNow()} ago, after{" "}
          {formatDistance(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.CANCELLED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatDistanceStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<ExclamationCircleOutlined />} color="error">
            cancelled
          </Tag>{" "}
          {moment(taskInfo.endTime).fromNow()} ago, after{" "}
          {formatDistance(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.FAILED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatDistanceStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<CloseCircleOutlined />} color="error">
            failed
          </Tag>{" "}
          {moment(taskInfo.endTime).fromNow()} ago after{" "}
          {formatDistance(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.COMPLETE:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatDistanceStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<CheckCircleOutlined />} color="success">
            completed
          </Tag>{" "}
          {moment(taskInfo.endTime).fromNow()} ago in{" "}
          {formatDistance(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    default:
      return null;
  }
}

export default function TaskListView({
  report,
  tasksWithHierarchy,
  expandedMetaTaskKeys,
  openMetatask,
  isLoading,
  onToggleExpandedMetaTaskKey,
  onReload,
}: {
  report: VoxelyticsWorkflowReport;
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>;
  expandedMetaTaskKeys: Record<string, boolean>;
  openMetatask: string | null;
  isLoading: boolean;
  onToggleExpandedMetaTaskKey: (v: string) => void;
  onReload: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // expandedTask = state of the collapsible list
  const [expandedTasks, setExpandedTasks] = useState<Array<string>>([]);
  const params = useParams<{ highlightedTask?: string }>();
  const highlightedTask = params.highlightedTask || "";
  const location = useLocation();

  useEffect(() => {
    setExpandedTasks([highlightedTask]);
    handleFocusTask(highlightedTask);
  }, [highlightedTask]);

  function handleFocusTask(focusedTask: string | null) {
    if (focusedTask == null) return;
    const elementId = `task-panel-${focusedTask}`;
    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  const miniSearch = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const miniSearch: MiniSearch<VoxelyticsTaskConfig> = new MiniSearch({
      fields: ["taskName", "task", "config.name"],
      idField: "taskName",
      extractField: (document, fieldName) => {
        // access nested fields
        let doc: any = document;
        for (const key of fieldName.split(".")) {
          if (doc != null) {
            doc = doc[key];
          }
        }
        return doc as string;
      },
    });

    // get all documents with empty search query
    const documents = getFilteredTasks(miniSearch, report, "");
    miniSearch.addAll(documents);

    return miniSearch;
  }, [report]);

  // filteredTasks = raw config/task objects to display. Either filtered by search or all objects
  const filteredTasks = useMemo(
    () => getFilteredTasks(miniSearch, report, searchQuery),
    [miniSearch, report, searchQuery],
  );

  function handleOnCollapseChange(newExpandedTasks: string | Array<string>) {
    setExpandedTasks(Array.isArray(newExpandedTasks) ? newExpandedTasks : [newExpandedTasks]);
  }

  function handleOnSearch(textValue: string) {
    setSearchQuery(textValue);
  }

  function handleSelectTask(taskName: string) {
    handleFocusTask(taskName);
    setSearchQuery("");

    if (!expandedTasks.includes(taskName)) {
      const expandedTasksCopy = [...expandedTasks, taskName];
      setExpandedTasks(expandedTasksCopy);
    }
  }

  function copyAllArtifactPaths() {
    const artifactPaths = Object.values(report.artifacts)
      .map((artifactObject) => Object.values(artifactObject).map((artifact) => artifact.path))
      .flat();

    navigator.clipboard.writeText(artifactPaths.join("\n")).then(
      () => notification.success({ message: "All artifacts path were copied to the clipboard" }),
      () =>
        notification.error({
          message: `Could not copy the following artifact paths to clipboard: ${artifactPaths.join(
            "\n",
          )}`,
        }),
    );
  }

  function downloadReportJSON() {
    const a = document.createElement("a");
    const json = JSON.stringify(report, null, 2);
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `VX_report_${report.workflow.name}.json`;
    a.click();
  }

  async function downloadWorkflowYAML() {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([report.workflow.yamlContent], { type: "application/yaml" }),
      );
      a.download = `${report.workflow.name}.yaml`;
      a.click();
    } catch (error) {
      message.error("Could not find YAML file for download.");
    }
  }

  async function downloadLog() {
    try {
      const logText = (await getVoxelyticsLogs(report.run.id, null, "DEBUG"))
        .map((line: any) =>
          formatLog(line, { timestamps: true, pid: true, level: true, logger: true }),
        )
        .join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([logText], { type: "plain/text" }));
      a.download = `${report.run.id}.log`;
      a.click();
    } catch (error) {
      message.error("Could not fetch log for download.");
    }
  }

  const colorHasher = new ColorHash({ lightness: [0.35, 0.5, 0.65] });

  const overflowMenu = (
    <Menu>
      <Menu.Item key="1" onClick={copyAllArtifactPaths}>
        Copy All Artifact Paths
      </Menu.Item>
      <Menu.Item key="2" onClick={downloadReportJSON}>
        Download Report as JSON
      </Menu.Item>
      <Menu.Item key="3" onClick={downloadWorkflowYAML}>
        Download Workflow YAML
      </Menu.Item>
      <Menu.Item key="4" onClick={downloadLog}>
        Download Log
      </Menu.Item>
    </Menu>
  );

  const renderTaskGroupOrTask = (taskGroup: VoxelyticsTaskConfigWithHierarchy) => {
    if (taskGroup.isMetaTask) {
      // If tasks are filtered away by the search query, it can happen that a meta task
      // has "no children", anymore. In that case, don't render the entire meta task.
      const subtasks = taskGroup.subtasks;
      const children = subtasks.map(renderTaskGroupOrTask).filter((c) => c != null);
      if (children.length === 0) {
        return null;
      }

      const taskInfo = aggregateTaskInfos(taskGroup, report.run.tasks);
      return (
        <Panel
          header={
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
              {taskGroup.key}

              <span className="task-panel-state">
                <TaskStateTag taskInfo={taskInfo} />
              </span>
            </div>
          }
          key={taskGroup.key}
          id={`task-panel-${taskGroup.key}`}
        >
          {openMetatask !== taskGroup.key && (
            <div style={{ marginBottom: 8 }}>
              <a
                href=""
                style={{ marginRight: 16 }}
                onClick={(ev) => {
                  ev.preventDefault();
                  onToggleExpandedMetaTaskKey(taskGroup.key);
                }}
              >
                {expandedMetaTaskKeys[taskGroup.key] ? "Collapse in DAG" : "Expand in DAG"}
              </a>
              <Link to={addUrlParam(location, "metatask", taskGroup.key)}>Open in extra View</Link>
            </div>
          )}
          <Collapse>{children}</Collapse>
        </Panel>
      );
    }
    const task = taskGroup;

    const isInFilteredTasks = filteredTasks.find((t) => t.taskName === task.taskName);
    if (!isInFilteredTasks) {
      return null;
    }

    const taskInfo = report.run.tasks.find(
      (t) => t.taskName === task.taskName,
    ) as VoxelyticsTaskInfo;

    return (
      <Panel
        header={
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
            {task.taskName}
            {task.config.name != null && (
              <span className="task-panel-name">{task.config.name}</span>
            )}
            <span className="task-panel-state">
              <TaskStateTag taskInfo={taskInfo} />
            </span>
          </div>
        }
        key={task.taskName}
        id={`task-panel-${task.taskName}`}
      >
        <TaskView
          taskName={task.taskName}
          workflowHash={report.workflow.hash}
          task={task}
          artifacts={report.artifacts[task.taskName] || []}
          dag={report.dag}
          taskInfo={taskInfo}
          onSelectTask={handleSelectTask}
        />
      </Panel>
    );
  };

  const {
    workflow: { name: readableWorkflowName },
    run: { beginTime: runBeginTimeString },
  } = report;

  return (
    <Row
      gutter={16}
      style={{
        minHeight: "calc(100vh - 100px)",
      }}
    >
      <Col xs={10} style={{ display: "flex", flexDirection: "column" }}>
        <h3>
          {readableWorkflowName}{" "}
          <span style={{ color: "#51686e" }}>
            {" "}
            {formatDateMedium(new Date(runBeginTimeString))}
          </span>
        </h3>
        <div style={{ flex: 1, position: "relative" }}>
          <DAGView
            key={filteredTasks.map((t) => t.taskName).join("_")}
            dag={report.dag}
            filteredTasks={filteredTasks}
            onClickHandler={handleSelectTask}
          />
        </div>
      </Col>
      <Col xs={14} className="task-panel">
        {openMetatask != null && (
          <div style={{ marginBottom: 8 }}>
            <Link to={removeUrlParam(location, "metatask")}>
              <LeftOutlined /> Show entire workflow
            </Link>
          </div>
        )}
        <div
          className="ant-collapse tasks-header"
          style={{
            marginBottom: 10,
            padding: 5,
            zIndex: 1,
            display: "flex",
          }}
        >
          <Search
            placeholder="Filter workflows"
            onSearch={handleOnSearch}
            style={{ width: 350 }}
            allowClear
          />
          <div style={{ flex: 1 }} />
          <Button onClick={() => onReload()}>
            <SyncOutlined spin={isLoading} /> Refresh
          </Button>
          <Dropdown.Button overlay={overflowMenu} onClick={() => setExpandedTasks([])}>
            Collapse All
          </Dropdown.Button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <Collapse onChange={handleOnCollapseChange} activeKey={expandedTasks}>
            {tasksWithHierarchy.map(renderTaskGroupOrTask)}
          </Collapse>
        </div>
      </Col>
    </Row>
  );
}

function aggregateTimes(taskInfos: Array<VoxelyticsTaskInfo>): [Date, Date] {
  return [
    new Date(taskInfos.reduce((r, a) => Math.min(r, a.beginTime?.getTime() ?? Infinity), Infinity)),
    new Date(taskInfos.reduce((r, a) => Math.max(r, a.endTime?.getTime() ?? -Infinity), -Infinity)),
  ];
}

function aggregateTaskInfos(
  task: VoxelyticsTaskConfigWithHierarchy,
  allTaskInfos: Array<VoxelyticsTaskInfo>,
): VoxelyticsTaskInfo {
  if (task.isMetaTask) {
    const taskInfos = task.subtasks.map((subTask) => aggregateTaskInfos(subTask, allTaskInfos));

    if (taskInfos.length === 0) {
      return {
        runId: "",
        runName: "",
        taskName: task.key,
        state: VoxelyticsRunState.SKIPPED,
        beginTime: null,
        endTime: null,
        currentExecutionId: null,
        chunksTotal: 0,
        chunksFinished: 0,
      };
    }

    let state = VoxelyticsRunState.PENDING;
    let beginTime = null;
    let endTime = null;

    if (taskInfos.every((t) => t.state === VoxelyticsRunState.SKIPPED)) {
      state = VoxelyticsRunState.SKIPPED;
    } else if (taskInfos.every((t) => t.state === VoxelyticsRunState.PENDING)) {
      state = VoxelyticsRunState.PENDING;
    } else if (
      taskInfos.every(
        (t) => t.state === VoxelyticsRunState.COMPLETE || t.state === VoxelyticsRunState.SKIPPED,
      )
    ) {
      state = VoxelyticsRunState.COMPLETE;
      [beginTime, endTime] = aggregateTimes(taskInfos);
    } else if (taskInfos.some((t) => t.state === VoxelyticsRunState.RUNNING)) {
      state = VoxelyticsRunState.RUNNING;
      const runningOrCompletedTasks = taskInfos
        .slice(0, taskInfos.findIndex((t) => t.state === VoxelyticsRunState.RUNNING) + 1)
        .filter((t) => [VoxelyticsRunState.COMPLETE, VoxelyticsRunState.RUNNING].includes(t.state));
      [beginTime, endTime] = aggregateTimes(runningOrCompletedTasks);
    } else {
      if (taskInfos.some((t) => t.state === VoxelyticsRunState.STALE)) {
        state = VoxelyticsRunState.STALE;
      } else if (taskInfos.some((t) => t.state === VoxelyticsRunState.CANCELLED)) {
        state = VoxelyticsRunState.CANCELLED;
      } else {
        state = VoxelyticsRunState.FAILED;
      }
      const finishedTasks = taskInfos.filter((t) =>
        [
          VoxelyticsRunState.COMPLETE,
          VoxelyticsRunState.CANCELLED,
          VoxelyticsRunState.FAILED,
        ].includes(t.state),
      );
      [beginTime, endTime] = aggregateTimes(finishedTasks);
    }

    return {
      runId: taskInfos[0].runId,
      runName: taskInfos[0].runName,
      taskName: task.key,
      state,
      beginTime,
      endTime,
    } as VoxelyticsTaskInfo;
  }

  return allTaskInfos.find((t) => t.taskName === task.taskName) as VoxelyticsTaskInfo;
}

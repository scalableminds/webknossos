import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FieldTimeOutlined,
  LeftOutlined,
  MinusCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Col,
  Collapse,
  type CollapseProps,
  Dropdown,
  Input,
  type MenuProps,
  Row,
  Select,
  Tag,
  Tooltip,
  message,
  notification,
} from "antd";
import MiniSearch from "minisearch";
import React, { useEffect, useState, useMemo } from "react";

import { deleteWorkflow, getVoxelyticsLogs } from "admin/rest_api";
import dayjs from "dayjs";
import {
  formatDateMedium,
  formatDurationStrict,
  formatTimeInterval,
  formatTimeIntervalStrict,
} from "libs/format_utils";
import { useSearchParams, useUpdateEvery, useWkSelector } from "libs/react_hooks";
import { notEmpty } from "libs/utils";
import { Link, useHistory, useLocation, useParams } from "react-router-dom";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskConfigWithHierarchy,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import type { ArrayElement } from "types/globals";
import { LOG_LEVELS } from "viewer/constants";
import ArtifactsDiskUsageList from "./artifacts_disk_usage_list";
import DAGView, { colorHasher } from "./dag_view";
import { formatLog } from "./log_tab";
import TaskView from "./task_view";
import { addAfterPadding, addBeforePadding } from "./utils";

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
  search.set(key, val);
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
                Current Duration: {formatDurationStrict(dayjs.duration(currentDuration))}
                <br />
                Estimated Remaining Duration:{" "}
                {formatDurationStrict(dayjs.duration(estimatedRemainingDuration))}
                <br />
                Estimated End Time: {formatDateMedium(estimatedEndTime)}
              </>
            }
          >
            <Tag icon={<SyncOutlined spin />} color="processing">
              running
            </Tag>
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
                Current Duration: {formatDurationStrict(dayjs.duration(currentDuration))}
              </>
            }
          >
            <Tag icon={<SyncOutlined spin />} color="processing">
              running
            </Tag>
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
          <Tag icon={<CloseCircleOutlined />} color="error">
            timed out
          </Tag>{" "}
          {dayjs(taskInfo.endTime).fromNow()}, after{" "}
          {formatTimeInterval(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.CANCELLED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<ExclamationCircleOutlined />} color="error">
            cancelled
          </Tag>{" "}
          {dayjs(taskInfo.endTime).fromNow()}, after{" "}
          {formatTimeInterval(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.FAILED:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<CloseCircleOutlined />} color="error">
            failed
          </Tag>{" "}
          {dayjs(taskInfo.endTime).fromNow()}, after{" "}
          {formatTimeInterval(taskInfo.endTime, taskInfo.beginTime)}
        </Tooltip>
      );
    case VoxelyticsRunState.COMPLETE:
      return (
        <Tooltip
          title={
            <>
              End Time: {formatDateMedium(taskInfo.endTime)}
              <br />
              Duration: {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
            </>
          }
        >
          <Tag icon={<CheckCircleOutlined />} color="success">
            completed
          </Tag>{" "}
          {dayjs(taskInfo.endTime).fromNow()},{" "}
          {formatTimeInterval(taskInfo.endTime, taskInfo.beginTime)}
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
  const { modal } = App.useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const { runId } = useSearchParams();
  const history = useHistory();

  // expandedTask = state of the collapsible list
  const [expandedTasks, setExpandedTasks] = useState<Array<string>>([]);
  const params = useParams<{ highlightedTask?: string }>();
  const highlightedTask = params.highlightedTask || "";
  const location = useLocation();

  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  const singleRunId = report.runs.length === 1 ? report.runs[0].id : runId;

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
    const artifactPaths = Object.values(report.artifacts).flatMap((artifactObject) =>
      Object.values(artifactObject).map((artifact) => artifact.path),
    );

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

  function showArtifactsDiskUsageList() {
    modal.info({
      title: "Disk Usage of Artifacts",
      content: (
        <ArtifactsDiskUsageList
          tasksWithHierarchy={tasksWithHierarchy}
          artifacts={report.artifacts}
        />
      ),
      width: "75%",
    });
  }

  async function downloadWorkflowYAML() {
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([report.workflow.yamlContent], { type: "application/yaml" }),
      );
      a.download = `${report.workflow.name}.yaml`;
      a.click();
    } catch (_error) {
      message.error("Could not find YAML file for download.");
    }
  }

  async function downloadLog() {
    try {
      if (singleRunId == null) {
        message.error("Please select a specific run for log download.");
        return;
      }
      const singleRun = report.runs.find((r) => r.id === singleRunId);
      const beginTime = singleRun?.beginTime;
      const endTime = singleRun?.endTime ?? new Date();

      if (beginTime == null) {
        message.error("Run hasn't started yet.");
        return;
      }

      const logText = (
        await getVoxelyticsLogs(
          singleRunId,
          null,
          LOG_LEVELS.DEBUG,
          addBeforePadding(beginTime),
          addAfterPadding(endTime),
        )
      )
        .map((line) => formatLog(line, { timestamps: true, pid: true, level: true, logger: true }))
        .join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([logText], { type: "plain/text" }));
      a.download = `${report.workflow.hash}_${singleRunId}.log`;
      a.click();
    } catch (error) {
      console.error(error);
      message.error("Could not fetch log for download.");
    }
  }

  async function deleteWorkflowReport() {
    await modal.confirm({
      title: "Delete Workflow Report",
      content:
        "Are you sure you want to delete this workflow report? This can not be undone. Note that if the workflow is still running, this may cause it to fail.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteWorkflow(report.workflow.hash);
          history.push("/workflows");
          message.success("Workflow report deleted.");
        } catch (error) {
          console.error(error);
          message.error("Could not delete workflow report.");
        }
      },
    });
  }

  const overflowMenu: MenuProps = {
    items: [
      { key: "1", onClick: copyAllArtifactPaths, label: "Copy All Artifact Paths" },
      { key: "2", onClick: downloadReportJSON, label: "Download Report as JSON" },
      { key: "3", onClick: downloadWorkflowYAML, label: "Download Workflow YAML" },
      {
        key: "4",
        onClick: downloadLog,
        disabled: singleRunId == null,
        label:
          singleRunId == null ? (
            <Tooltip title="Please select a specific run for log download.">
              <div>Download Log</div>
            </Tooltip>
          ) : (
            "Download Log"
          ),
      },
      { key: "5", onClick: showArtifactsDiskUsageList, label: "Show Disk Usage of Artifacts" },
    ],
  };
  if (isCurrentUserSuperUser)
    overflowMenu.items?.push({
      key: "6",
      onClick: deleteWorkflowReport,
      label: "Delete Workflow Report",
    });

  type ItemType = ArrayElement<CollapseProps["items"]>;

  const getTaskGroupOrTaskItem = (
    taskGroup: VoxelyticsTaskConfigWithHierarchy,
  ): ItemType | undefined => {
    const taskInfo = aggregateTaskInfos(taskGroup, report.tasks, runId);

    if (taskGroup.isMetaTask) {
      // If tasks are filtered away by the search query, it can happen that a meta task
      // has "no children", anymore. In that case, don't render the entire meta task.
      const subtasks = taskGroup.subtasks;
      const collapseItems = subtasks.map(getTaskGroupOrTaskItem).filter(notEmpty);
      if (collapseItems.length === 0) {
        return undefined;
      }

      return {
        key: taskGroup.key,
        id: `task-panel-${taskGroup.key}`,
        label: (
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
            <wbr />
            <span className="task-panel-state">
              <TaskStateTag taskInfo={taskInfo} />
            </span>
          </div>
        ),
        children: (
          <React.Fragment>
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
                <Link to={addUrlParam(location, "metatask", taskGroup.key)}>
                  Open in extra View
                </Link>
              </div>
            )}
            <Collapse items={collapseItems} />
          </React.Fragment>
        ),
      };
    }
    const task = taskGroup;

    const isInFilteredTasks = filteredTasks.find((t) => t.taskName === task.taskName);
    if (!isInFilteredTasks) {
      return undefined;
    }

    const taskArtifacts = report.artifacts[task.taskName] || {};
    let foreignWorkflow: null | [string, string] = null;
    if (taskInfo.state === VoxelyticsRunState.SKIPPED) {
      foreignWorkflow = Object.values(taskArtifacts)[0]?.foreignWorkflow ?? null;
    }

    return {
      key: task.taskName,
      id: `task-panel-${task.taskName}`,
      label: (
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
            <>
              <Link to={`/workflows/${foreignWorkflow[0]}?runId=${foreignWorkflow[1]}`}>
                {task.taskName}
                &nbsp;
                <ExportOutlined />
              </Link>
            </>
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
      ),
      children: (
        <TaskView
          taskName={task.taskName}
          workflowHash={report.workflow.hash}
          runId={singleRunId}
          task={task}
          artifacts={taskArtifacts}
          dag={report.dag}
          taskInfo={taskInfo}
          onSelectTask={handleSelectTask}
        />
      ),
    };
  };

  const totalRuntime = report.tasks.reduce((sum, t) => {
    if (t.state === VoxelyticsRunState.RUNNING) {
      return sum.add(dayjs.duration(dayjs().diff(dayjs(t.beginTime))));
    } else if (t.beginTime != null && t.endTime != null) {
      return sum.add(dayjs.duration(dayjs(t.endTime).diff(dayjs(t.beginTime))));
    } else {
      return sum;
    }
  }, dayjs.duration(0));

  const {
    workflow: { name: readableWorkflowName },
  } = report;
  const runBeginTimeString = report.runs.reduce(
    (r, a) => Math.min(r, a.beginTime != null ? a.beginTime.getTime() : Number.POSITIVE_INFINITY),
    Number.POSITIVE_INFINITY,
  );

  return (
    <Row
      gutter={16}
      style={{
        minHeight: "calc(100vh - 100px)",
      }}
    >
      <Col xs={10} style={{ display: "flex", flexDirection: "column" }}>
        <h3
          style={{
            marginBottom: 0,
            maxWidth: "100%",
            overflowWrap: "anywhere",
          }}
          title={readableWorkflowName}
        >
          {readableWorkflowName}
        </h3>
        <h4 style={{ color: "#51686e" }}>
          {formatDateMedium(new Date(runBeginTimeString))}{" "}
          <Tooltip title={formatDurationStrict(totalRuntime)}>
            <FieldTimeOutlined style={{ marginLeft: 20 }} className="icon-margin-right" />
            {totalRuntime.humanize()}
          </Tooltip>
        </h4>
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
            style={{ minWidth: 150 }}
            allowClear
          />
          <div style={{ flex: 1 }} />
          <Button onClick={() => onReload()}>
            <SyncOutlined spin={isLoading} /> Refresh
          </Button>
          <Select
            value={runId ?? ""}
            onChange={(value) =>
              history.replace(
                value === ""
                  ? removeUrlParam(history.location, "runId")
                  : addUrlParam(history.location, "runId", value),
              )
            }
            style={{ maxWidth: "70%" }}
          >
            <Select.Option value="">Consolidated</Select.Option>
            {report.runs.map((run) => (
              <Select.Option value={run.id} key={run.id}>
                {run.name}
              </Select.Option>
            ))}
          </Select>
          <Dropdown.Button menu={overflowMenu} onClick={() => setExpandedTasks([])}>
            Collapse All
          </Dropdown.Button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <Collapse
            onChange={handleOnCollapseChange}
            activeKey={expandedTasks}
            items={tasksWithHierarchy.map(getTaskGroupOrTaskItem).filter(notEmpty)}
          />
        </div>
      </Col>
    </Row>
  );
}

function aggregateTimes(taskInfos: Array<VoxelyticsTaskInfo>): [Date, Date] {
  return [
    new Date(
      taskInfos.reduce(
        (r, a) => Math.min(r, a.beginTime?.getTime() ?? Number.POSITIVE_INFINITY),
        Number.POSITIVE_INFINITY,
      ),
    ),
    new Date(
      taskInfos.reduce(
        (r, a) => Math.max(r, a.endTime?.getTime() ?? Number.NEGATIVE_INFINITY),
        Number.NEGATIVE_INFINITY,
      ),
    ),
  ];
}

function aggregateTaskInfos(
  task: VoxelyticsTaskConfigWithHierarchy,
  allTaskInfos: Array<VoxelyticsTaskInfo>,
  runId: string | null,
): VoxelyticsTaskInfo {
  if (task.isMetaTask) {
    const taskInfos = task.subtasks.map((subTask) =>
      aggregateTaskInfos(subTask, allTaskInfos, runId),
    );

    if (taskInfos.length === 0) {
      return {
        taskName: task.key,
        state: VoxelyticsRunState.SKIPPED,
        currentExecutionId: null,
        chunkCounts: {
          total: 0,
          failed: 0,
          skipped: 0,
          complete: 0,
          cancelled: 0,
        },
        beginTime: null,
        endTime: null,
        runs: [],
      };
    }

    let state = VoxelyticsRunState.PENDING;
    let beginTime = null;
    let endTime = null;

    if (taskInfos.every((t) => t.state === VoxelyticsRunState.SKIPPED)) {
      state = VoxelyticsRunState.SKIPPED;
    } else if (
      taskInfos.every(
        (t) => t.state === VoxelyticsRunState.PENDING || t.state === VoxelyticsRunState.SKIPPED,
      )
    ) {
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
      taskName: task.key,
      state,
      beginTime,
      endTime,
      currentExecutionId: null,
      chunkCounts: {
        total: taskInfos.reduce((r, a) => r + a.chunkCounts.total, 0),
        failed: taskInfos.reduce((r, a) => r + a.chunkCounts.failed, 0),
        skipped: taskInfos.reduce((r, a) => r + a.chunkCounts.skipped, 0),
        complete: taskInfos.reduce((r, a) => r + a.chunkCounts.complete, 0),
        cancelled: taskInfos.reduce((r, a) => r + a.chunkCounts.cancelled, 0),
      },
      runs: [],
    } as VoxelyticsTaskInfo;
  }

  const taskInfo = allTaskInfos.find((t) => t.taskName === task.taskName) as VoxelyticsTaskInfo;
  if (runId != null) {
    return {
      ...taskInfo.runs.find((tr) => tr.runId === runId),
      taskName: taskInfo.taskName,
    } as VoxelyticsTaskInfo;
  }
  return taskInfo;
}

import {
  ApartmentOutlined,
  DownOutlined,
  ExportOutlined,
  FieldTimeOutlined,
  LeftOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { deleteWorkflow, getVoxelyticsLogs } from "admin/rest_api";
import {
  App,
  Button,
  Col,
  Collapse,
  type CollapseProps,
  Dropdown,
  Flex,
  Grid,
  Input,
  type MenuProps,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import {
  formatDateMedium,
  formatDurationStrict,
  formatTimeIntervalStrict,
} from "libs/format_utils";
import { useUpdateEvery, useWkSelector } from "libs/react_hooks";
import { notEmpty } from "libs/utils";
import MiniSearch from "minisearch";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ModalWidth } from "theme";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskConfigWithHierarchy,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import type { ArrayElement } from "types/type_utils";
import { LOG_LEVELS } from "viewer/constants";
import ArtifactsDiskUsageList from "./artifacts_disk_usage_list";
import DAGView, { colorHasher } from "./dag_view";
import { formatLog } from "./log_tab";
import RunStateTag from "./run_state_tag";
import { getTaskExecutions, type TaskListLocationState } from "./task_runs_tab";
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
                Current Duration: {formatDurationStrict(dayjs.duration(currentDuration))}
                <br />
                Estimated Remaining Duration:{" "}
                {formatDurationStrict(dayjs.duration(estimatedRemainingDuration))}
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
                Current Duration: {formatDurationStrict(dayjs.duration(currentDuration))}
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
          after {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
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
          <RunStateTag state={VoxelyticsRunState.CANCELLED} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
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
          <RunStateTag state={VoxelyticsRunState.FAILED} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
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
          <RunStateTag state={VoxelyticsRunState.COMPLETE} /> {dayjs(taskInfo.endTime).fromNow()},
          after {formatTimeIntervalStrict(taskInfo.endTime, taskInfo.beginTime)}
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
  runId,
}: {
  report: VoxelyticsWorkflowReport;
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>;
  expandedMetaTaskKeys: Record<string, boolean>;
  openMetatask: string | null;
  isLoading: boolean;
  onToggleExpandedMetaTaskKey: (v: string) => void;
  onReload: () => void;
  runId: string | null;
}) {
  const { modal, message, notification } = App.useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  // expandedTask = state of the collapsible list
  const [expandedTasks, setExpandedTasks] = useState<Array<string>>([]);
  // Wrapped in an object so that focusing the same task again triggers a new scroll.
  const [taskToFocus, setTaskToFocus] = useState<{ taskName: string } | null>(null);
  const location = useLocation();

  // Derived from the report's tasks and runs, which are replaced (not mutated) whenever the
  // report is refetched, so this is recomputed for every new report.
  const taskExecutionsByTask = useMemo(() => {
    const runsById = new Map(report.runs.map((run) => [run.id, run]));
    return new Map(report.tasks.map((t) => [t.taskName, getTaskExecutions(t.runs, runsById)]));
  }, [report.tasks, report.runs]);

  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  // On small screens (e.g., phones), the DAG takes up too much space. Hide it by default
  // and stack it above the task list once the user chooses to show it.
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.md;
  const [isDagVisibleOnCompact, setIsDagVisibleOnCompact] = useState(false);
  const isDagVisible = !isCompact || isDagVisibleOnCompact;

  const singleRunId = report.runs.length === 1 ? report.runs[0].id : runId;

  // Links to a task in another run pass the task via the location state. Depending on the
  // location key (instead of the task name) re-focuses the task on every navigation, because
  // this view stays mounted when switching between runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only run when navigating.
  useEffect(() => {
    const highlightedTask = (location.state as TaskListLocationState | null)?.highlightedTask;
    if (highlightedTask != null) handleSelectTask(highlightedTask);
  }, [location.key]);

  // Scroll only after the task panel was expanded (and the search was cleared) and rendered.
  // Other panels stay as they are, so the layout above the task doesn't shift during the scroll.
  useEffect(() => {
    if (taskToFocus == null) return;
    const element = document.getElementById(`task-panel-${taskToFocus.taskName}`);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [taskToFocus]);

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

  // expandedTasks holds the active keys of the outer and all nested (meta task) collapses.
  // Each collapse only reports its own keys, so only those are replaced.
  function handleOnCollapseChange(
    collapseKeys: Array<string>,
    newExpandedTasks: string | Array<string>,
  ) {
    const newKeys = Array.isArray(newExpandedTasks) ? newExpandedTasks : [newExpandedTasks];
    setExpandedTasks((expanded) => [
      ...expanded.filter((key) => !collapseKeys.includes(key)),
      ...newKeys,
    ]);
  }

  function handleOnSearch(textValue: string) {
    setSearchQuery(textValue);
  }

  function handleSelectTask(taskName: string) {
    setSearchQuery("");
    // Also expand the meta tasks containing the task (e.g., "a" and "a@b" for "a@b@c").
    const parts = taskName.split("@");
    const keysToExpand = parts.map((_, i) => parts.slice(0, i + 1).join("@"));
    setExpandedTasks((expanded) => [
      ...expanded,
      ...keysToExpand.filter((key) => !expanded.includes(key)),
    ]);
    setTaskToFocus({ taskName });
  }

  function copyAllArtifactPaths() {
    const artifactPaths = Object.values(report.artifacts).flatMap((artifactObject) =>
      Object.values(artifactObject).map((artifact) => artifact.path),
    );

    navigator.clipboard.writeText(artifactPaths.join("\n")).then(
      () => notification.success({ title: "All artifact paths were copied to the clipboard" }),
      () =>
        notification.error({
          title: "Could not copy artifact paths",
          description: `Could not copy the following artifact paths to clipboard: ${artifactPaths.join(
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
      width: ModalWidth.Full,
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

    try {
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
      okType: "danger",
      onOk: async () => {
        try {
          await deleteWorkflow(report.workflow.hash);
          navigate("/workflows");
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
            <Collapse
              onChange={(keys) =>
                handleOnCollapseChange(
                  collapseItems.map((item) => String(item.key)),
                  keys,
                )
              }
              activeKey={expandedTasks}
              items={collapseItems}
            />
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
            <Link
              to={`/workflows/${foreignWorkflow[0]}/run/${encodeURIComponent(foreignWorkflow[1])}`}
            >
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
          taskExecutions={taskExecutionsByTask.get(task.taskName) ?? []}
          onSelectTask={handleSelectTask}
        />
      ),
    };
  };

  const topLevelCollapseItems = tasksWithHierarchy.map(getTaskGroupOrTaskItem).filter(notEmpty);

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
      <Col xs={24} md={10}>
        <Flex vertical style={{ height: "100%" }}>
          <Typography.Title
            level={3}
            style={{
              marginBottom: 0,
              maxWidth: "100%",
              overflowWrap: "anywhere",
            }}
            title={readableWorkflowName}
          >
            {readableWorkflowName}
          </Typography.Title>
          {/* marginTop: 0 keeps the previous spacing; antd would otherwise add a top margin
              because this heading directly follows another Typography element. */}
          <Typography.Title
            level={4}
            style={{ color: "var(--ant-color-text-secondary)", marginTop: 0 }}
          >
            {formatDateMedium(new Date(runBeginTimeString))}{" "}
            <Tooltip title={formatDurationStrict(totalRuntime)}>
              <FieldTimeOutlined style={{ marginLeft: 20 }} className="icon-margin-right" />
              {totalRuntime.humanize()}
            </Tooltip>
          </Typography.Title>
          {isCompact && (
            <Button
              icon={<ApartmentOutlined />}
              onClick={() => setIsDagVisibleOnCompact(!isDagVisibleOnCompact)}
              style={{ alignSelf: "flex-start", marginBottom: 10 }}
            >
              {isDagVisibleOnCompact ? "Hide Workflow Graph" : "Show Workflow Graph"}
            </Button>
          )}
          {isDagVisible && (
            <div
              style={
                isCompact
                  ? { height: "60vh", position: "relative", marginBottom: 10 }
                  : { flex: 1, position: "relative" }
              }
            >
              <DAGView
                dag={report.dag}
                filteredTasks={filteredTasks}
                onClickHandler={handleSelectTask}
              />
            </div>
          )}
        </Flex>
      </Col>
      <Col xs={24} md={14} className="task-panel">
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
            zIndex: 1,
          }}
        >
          <Flex gap={"small"} wrap>
            <Search
              placeholder="Filter tasks"
              onSearch={handleOnSearch}
              style={{ flex: "1 1 150px" }}
              allowClear
            />
            <Space wrap>
              <Button onClick={() => onReload()} icon={<SyncOutlined spin={isLoading} />}>
                Refresh
              </Button>
              <Select
                value={runId ?? ""}
                onChange={(value) => {
                  const basePath = `/workflows/${report.workflow.hash}`;
                  navigate(
                    value === "" ? `${basePath}` : `${basePath}/run/${encodeURIComponent(value)}`,
                  );
                }}
                popupMatchSelectWidth={false}
                styles={{
                  root: {
                    maxWidth: 200,
                  },
                  popup: {
                    root: {
                      maxWidth: "90vw",
                    },
                  },
                }}
                options={[
                  { value: "", label: "Consolidated" },
                  ...report.runs.map((run) => ({ value: run.id, label: run.name })),
                ]}
              />
              <Space.Compact>
                <Button onClick={() => setExpandedTasks([])}>Collapse All</Button>
                <Dropdown menu={overflowMenu}>
                  <Button icon={<DownOutlined />} />
                </Dropdown>
              </Space.Compact>
            </Space>
          </Flex>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <Collapse
            onChange={(keys) =>
              handleOnCollapseChange(
                topLevelCollapseItems.map((item) => String(item.key)),
                keys,
              )
            }
            activeKey={expandedTasks}
            items={topLevelCollapseItems}
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
  if (taskInfo === undefined) {
    throw new Error(`Task info not found for task ${task.taskName}.`);
  }

  if (runId != null) {
    const taskRun = taskInfo.runs.find((tr) => tr.runId === runId);
    if (taskRun === undefined) {
      throw new Error(
        `Task run ${runId} not found for task ${task.taskName}. Task might be from a different VX report.`,
      );
    }

    return {
      ...taskRun,
      taskName: taskInfo.taskName,
      runs: [],
    } as VoxelyticsTaskInfo;
  }
  return taskInfo;
}

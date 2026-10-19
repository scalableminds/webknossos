import {
  ApartmentOutlined,
  DownOutlined,
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
import { formatDateMedium, formatDurationStrict } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { notEmpty } from "libs/utils";
import MiniSearch from "minisearch";
import React, { useMemo, useState } from "react";
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
import DAGView from "./dag_view";
import { formatLog } from "./log_tab";
import { getTaskInfosWithHierarchy } from "./task_hierarchy";
import { getTaskPanelId, useTaskFocus, useTaskPanelExpansion } from "./task_hierarchy_hooks";
import { MetaTaskPanelLabel, TaskPanelLabel } from "./task_panel_labels";
import { getTaskExecutions } from "./task_runs_tab";
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

type ItemType = ArrayElement<CollapseProps["items"]>;

// A (possibly nested) collapse of the task list. All collapses share the expanded keys.
function TaskCollapse({
  items,
  expandedKeys,
  onChange,
}: {
  items: Array<ItemType>;
  expandedKeys: Array<string>;
  onChange: (collapseKeys: Array<string>, activeKeys: string | Array<string>) => void;
}) {
  return (
    <Collapse
      onChange={(activeKeys) =>
        onChange(
          items.map((item) => String(item.key)),
          activeKeys,
        )
      }
      activeKey={expandedKeys}
      items={items}
    />
  );
}

export default function TaskListView({
  report,
  tasksWithHierarchy,
  isMetaTaskExpandedInDag,
  openMetatask,
  isLoading,
  onToggleMetaTaskInDag,
  onReload,
  runId,
}: {
  report: VoxelyticsWorkflowReport;
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>;
  isMetaTaskExpandedInDag: (metaTaskKey: string) => boolean;
  openMetatask: string | null;
  isLoading: boolean;
  onToggleMetaTaskInDag: (metaTaskKey: string) => void;
  onReload: () => void;
  runId: string | null;
}) {
  const { modal, message, notification } = App.useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const location = useLocation();
  const { expandedKeys, setActiveKeysOfCollapse, expandTask, collapseAll } =
    useTaskPanelExpansion();
  const focusTask = useTaskFocus((taskName) => {
    setSearchQuery("");
    expandTask(taskName);
  });

  // Derived from the report's tasks and runs, which are replaced (not mutated) whenever the
  // report is refetched, so this is recomputed for every new report.
  const taskExecutionsByTask = useMemo(() => {
    const runsById = new Map(report.runs.map((run) => [run.id, run]));
    return new Map(report.tasks.map((t) => [t.taskName, getTaskExecutions(t.runs, runsById)]));
  }, [report.tasks, report.runs]);

  const taskInfos = useMemo(
    () => getTaskInfosWithHierarchy(tasksWithHierarchy, report.tasks, runId),
    [tasksWithHierarchy, report.tasks, runId],
  );

  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  // On small screens (e.g., phones), the DAG takes up too much space. Hide it by default
  // and stack it above the task list once the user chooses to show it.
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.md;
  const [isDagVisibleOnCompact, setIsDagVisibleOnCompact] = useState(false);
  const isDagVisible = !isCompact || isDagVisibleOnCompact;

  const singleRunId = report.runs.length === 1 ? report.runs[0].id : runId;

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

  function handleOnSearch(textValue: string) {
    setSearchQuery(textValue);
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

  // Returns undefined for tasks which are filtered away by the search query and for meta tasks
  // without any remaining subtasks.
  const getTaskGroupOrTaskItem = (
    taskGroup: VoxelyticsTaskConfigWithHierarchy,
  ): ItemType | undefined => {
    if (taskGroup.isMetaTask) {
      const collapseItems = taskGroup.subtasks.map(getTaskGroupOrTaskItem).filter(notEmpty);
      if (collapseItems.length === 0) {
        return undefined;
      }
      const metaTaskInfo = taskInfos.get(taskGroup.key) as VoxelyticsTaskInfo;

      return {
        key: taskGroup.key,
        id: getTaskPanelId(taskGroup.key),
        label: <MetaTaskPanelLabel metaTaskKey={taskGroup.key} taskInfo={metaTaskInfo} />,
        children: (
          <React.Fragment>
            {openMetatask !== taskGroup.key && (
              <div style={{ marginBottom: 8 }}>
                <a
                  href=""
                  style={{ marginRight: 16 }}
                  onClick={(ev) => {
                    ev.preventDefault();
                    onToggleMetaTaskInDag(taskGroup.key);
                  }}
                >
                  {isMetaTaskExpandedInDag(taskGroup.key) ? "Collapse in DAG" : "Expand in DAG"}
                </a>
                <Link to={addUrlParam(location, "metatask", taskGroup.key)}>
                  Open in extra View
                </Link>
              </div>
            )}
            <TaskCollapse
              items={collapseItems}
              expandedKeys={expandedKeys}
              onChange={setActiveKeysOfCollapse}
            />
          </React.Fragment>
        ),
      };
    }

    const task = taskGroup;
    if (!filteredTasks.some((t) => t.taskName === task.taskName)) {
      return undefined;
    }
    const taskInfo = taskInfos.get(task.taskName) as VoxelyticsTaskInfo;
    const taskArtifacts = report.artifacts[task.taskName] || {};
    const foreignWorkflow =
      taskInfo.state === VoxelyticsRunState.SKIPPED
        ? (Object.values(taskArtifacts)[0]?.foreignWorkflow ?? null)
        : null;

    return {
      key: task.taskName,
      id: getTaskPanelId(task.taskName),
      label: <TaskPanelLabel task={task} taskInfo={taskInfo} foreignWorkflow={foreignWorkflow} />,
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
          onSelectTask={focusTask}
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
              <DAGView dag={report.dag} filteredTasks={filteredTasks} onClickHandler={focusTask} />
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
                <Button onClick={collapseAll}>Collapse All</Button>
                <Dropdown menu={overflowMenu}>
                  <Button icon={<DownOutlined />} />
                </Dropdown>
              </Space.Compact>
            </Space>
          </Flex>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          <TaskCollapse
            items={topLevelCollapseItems}
            expandedKeys={expandedKeys}
            onChange={setActiveKeysOfCollapse}
          />
        </div>
      </Col>
    </Row>
  );
}

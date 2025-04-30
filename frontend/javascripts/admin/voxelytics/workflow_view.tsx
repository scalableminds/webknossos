import { getVoxelyticsWorkflow, isWorkflowAccessibleBySwitching } from "admin/rest_api";
import BrainSpinner, { BrainSpinnerWithError } from "components/brain_spinner";
import { usePolling, useSearchParams } from "libs/react_hooks";
import Toast from "libs/toast";
import _ from "lodash";
import type { OxalisState } from "oxalis/store";
import TabTitle from "oxalis/view/components/tab_title_component";
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "react-router-dom";
import {
  type APIOrganization,
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskConfigWithHierarchy,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import TaskListView from "./task_list_view";
import { VX_POLLING_INTERVAL } from "./utils";

type LoadingState =
  | { status: "PENDING" }
  | { status: "READY" }
  | { status: "LOADING" }
  | { status: "FAILED"; error: Error; organizationToSwitchTo?: APIOrganization };

function lexicographicalTopologicalSort(
  nodes: Array<VoxelyticsWorkflowDagNode>,
  edges: Array<VoxelyticsWorkflowDagEdge>,
): Array<VoxelyticsWorkflowDagNode> {
  // See https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm
  const output: Array<VoxelyticsWorkflowDagNode> = [];
  const allNodes = nodes.slice(0);
  let edgeList = edges.slice(0);
  const nodeList = allNodes.filter((n) => !edgeList.some((e) => e.target === n.id));

  // while nodeList is not empty do
  while (nodeList.length > 0) {
    // Poor person's priority queue
    nodeList.sort((a, b) => a.id.localeCompare(b.id));
    // remove a node node0 from nodeList
    const node0 = nodeList.shift();
    if (node0 != null) {
      // add node0 to output
      output.push(node0);
      // for each node node1 with an edge e from node0 to node1 do
      for (const node1 of allNodes) {
        const hasEdge = edgeList.some((e) => e.source === node0.id && e.target === node1.id);
        if (hasEdge) {
          // remove edge e from the graph
          edgeList = edgeList.filter((e) => e.source !== node0.id || e.target !== node1.id);
          // if node1 has no other incoming edges then
          if (!edgeList.some((e) => e.target === node1.id)) {
            // insert node1 into nodeList
            nodeList.push(node1);
          }
        }
      }
    }
  }

  if (edgeList.length > 0) {
    throw new Error("Graph has a cycle");
  } else {
    return output;
  }
}

function parseDag(
  tasks: Record<string, VoxelyticsTaskConfig>,
  taskInfos: Array<VoxelyticsTaskInfo>,
): VoxelyticsWorkflowDag {
  const dag: VoxelyticsWorkflowDag = {
    nodes: [],
    edges: [],
  };

  for (const [taskName, task] of Object.entries(tasks)) {
    dag.nodes.push({
      id: taskName,
      label: taskName,
      state: taskInfos.find((t) => t.taskName === taskName)?.state ?? VoxelyticsRunState.PENDING,
      isMetaTask: task.isMetaTask,
    });
    for (const [key, input] of Object.entries(task.inputs)) {
      const parseInput = (_input: string | Record<string, string>, _key: string) => {
        if (typeof _input === "string") {
          if (_input.includes(":")) {
            const [sourceTask] = _input.split(":");
            dag.edges.push({
              source: sourceTask,
              target: taskName,
              label: _key,
            });
          }
        } else if (_input != null) {
          for (const [subKey, subInput] of Object.entries(_input)) {
            parseInput(subInput, `${_key}.${subKey}`);
          }
        }
      };

      parseInput(input, key);
    }
  }
  dag.edges = dag.edges.filter(
    (e) => dag.nodes.some((n) => n.id === e.source) && dag.nodes.some((n) => n.id === e.target),
  );
  dag.nodes = lexicographicalTopologicalSort(dag.nodes, dag.edges);
  return dag;
}

function parseReport(report: VoxelyticsWorkflowReport): VoxelyticsWorkflowReport {
  const tasks = report.tasks.map(
    (t) =>
      ({
        ...t,
        runs: t.runs.map((r) => ({
          ...r,
          beginTime: r.beginTime != null ? new Date(r.beginTime) : null,
          endTime: r.endTime != null ? new Date(r.endTime) : null,
        })),
        beginTime: t.beginTime != null ? new Date(t.beginTime) : null,
        endTime: t.endTime != null ? new Date(t.endTime) : null,
        state: t.state,
      }) as VoxelyticsTaskInfo,
  );
  const dag = parseDag(report.config.tasks, tasks);
  return {
    ...report,
    config: {
      ...report.config,
      tasks: Object.fromEntries(dag.nodes.map((t) => [t.id, report.config.tasks[t.id]])),
    },
    dag,
    runs: report.runs.map((run) => ({
      ...run,
      beginTime: run.beginTime == null ? null : new Date(run.beginTime),
      endTime: run.endTime == null ? null : new Date(run.endTime),
    })),
    tasks,
  };
}

function getTasksWithHierarchy(report: VoxelyticsWorkflowReport): {
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>;
  metaTaskKeys: Array<string>;
  allTasks: Array<VoxelyticsTaskConfigWithName>;
} {
  // Returns
  // - allTasks (~ report.config.tasks, but as an array instead of an object)
  // - metaTaskKeys (all keys of meta tasks)
  // - tasksWithHierarchy (a hierarchical structure which reflects the meta task hierarchy)
  const tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy> = [];
  const subTasksByKey: Record<string, Array<VoxelyticsTaskConfigWithHierarchy>> = {};
  const allTasks: Array<VoxelyticsTaskConfigWithName> = Object.keys(report.config.tasks).map(
    (key) => ({
      ...report.config.tasks[key],
      taskName: key,
    }),
  );
  for (const task of allTasks) {
    const parts = task.taskName.split("@");

    // No nesting <==> nestingLevel === 0
    const nestingLevel = parts.length - 1;
    if (nestingLevel > 0) {
      // The current task belongs to a meta task.

      // For task.taskName === "a@b@c@d", key would be "a@b@c"
      const key = parts.slice(0, nestingLevel).join("@");
      if (subTasksByKey[key] == null) {
        // The metatask wasn't seen, yet. If it belongs to the top-level
        // (nestingLevel == 1), it will be added to the top-level tasksWithHierarchy.
        // Otherwise, it will be attached to the corresponding parent meta task.
        subTasksByKey[key] = [];
        if (nestingLevel === 1) {
          tasksWithHierarchy.push({ isMetaTask: true, key, subtasks: subTasksByKey[key] });
        } else {
          const parentKey = parts.slice(0, nestingLevel - 1).join("@");
          if (subTasksByKey[parentKey] != null) {
            subTasksByKey[parentKey].push({ isMetaTask: true, key, subtasks: subTasksByKey[key] });
          } else {
            tasksWithHierarchy.push({ isMetaTask: true, key, subtasks: subTasksByKey[key] });
          }
        }
      }
      subTasksByKey[key].push(task);
    } else {
      // No metatask.
      tasksWithHierarchy.push(task);
    }
  }
  const metaTaskKeys = Object.keys(subTasksByKey);

  return { tasksWithHierarchy, metaTaskKeys, allTasks };
}

function collapseReport(
  report: VoxelyticsWorkflowReport,
  expandedKeys: Record<string, boolean>,
): VoxelyticsWorkflowReport {
  // Given a report and an array of meta task keys which should be collapsed
  // this function adapts nodes and edges of the given dag so that
  // tasks that belong to the specified meta tasks are collapsed into single
  // nodes (one node per meta task).
  const newNodesDict: Record<string, VoxelyticsWorkflowDagNode> = {};

  for (const node of report.dag.nodes) {
    const [metaTaskKey, shouldBeCollapsed] = shouldCollapseId(node.id, expandedKeys);

    if (shouldBeCollapsed) {
      newNodesDict[metaTaskKey] = {
        ...node,
        id: metaTaskKey,
        label: metaTaskKey,
        isMetaTask: true,
      };
    } else {
      newNodesDict[node.id] = node;
    }
  }

  const newNodes = Array.from(Object.values(newNodesDict));

  const newEdgesDict: Record<string, VoxelyticsWorkflowDagEdge> = {};
  for (const edge of report.dag.edges) {
    const [collapsedSource] = shouldCollapseId(edge.source, expandedKeys);
    const [collapsedTarget] = shouldCollapseId(edge.target, expandedKeys);

    // If the edge connects two nodes which are in the same collapsed meta task,
    // the collapsed source and target will be equal. Since this would produce
    // self-edges, we check explicitly for this.
    if (collapsedSource !== collapsedTarget) {
      newEdgesDict[`${collapsedSource}-${collapsedTarget}`] = {
        ...edge,
        source: collapsedSource,
        target: collapsedTarget,
      };
    }
  }

  const newEdges = Array.from(Object.values(newEdgesDict));

  const collapsedReport = {
    ...report,
    dag: {
      ...report.dag,
      nodes: newNodes,
      edges: newEdges,
    },
  };

  return collapsedReport;
}

function selectMetaTask(
  report: VoxelyticsWorkflowReport,
  selectedMetaTask: string,
): VoxelyticsWorkflowReport {
  // If the GET parameter `metatask` is set, the report
  // is filtered so that only tasks which belong to the specified meta task
  // are shown.

  const newNodesDict: Record<string, VoxelyticsWorkflowDagNode> = {};
  for (const node of report.dag.nodes) {
    if (node.id.startsWith(selectedMetaTask)) {
      newNodesDict[node.id] = node;
    }
  }

  const newNodes = Array.from(Object.values(newNodesDict));

  const newEdges: Array<VoxelyticsWorkflowDagEdge> = [];
  for (const edge of report.dag.edges) {
    if (edge.source.startsWith(selectedMetaTask) && edge.target.startsWith(selectedMetaTask)) {
      newEdges.push(edge);
    }
  }

  const newTasks = Object.fromEntries(
    Object.entries(report.config.tasks).filter(([key]) => key.startsWith(selectedMetaTask)),
  );

  const collapsedReport = {
    ...report,
    config: {
      ...report.config,
      tasks: newTasks,
    },
    dag: {
      ...report.dag,
      nodes: newNodes,
      edges: newEdges,
    },
  };

  return collapsedReport;
}

function shouldCollapseId(id: string, expandedKeys: Record<string, boolean>): [string, boolean] {
  // For a given task id, it is checked whether the task should be collapsed
  // since it belongs to a meta task that should be collapsed.
  // Returns [maybeCollapsedId, isCollapsed].
  // maybeCollapsedId will either be
  // - the original task id
  // - the key of the collapsed meta task to which the task belongs
  for (const [key, isExpanded] of Object.entries(expandedKeys)) {
    if (!isExpanded && id.startsWith(key)) {
      return [key, true];
    }
  }
  return [id, false];
}

export default function WorkflowView() {
  const { workflowName } = useParams<{ workflowName: string }>();
  const { metatask } = useSearchParams();
  const user = useSelector((state: OxalisState) => state.activeUser);

  const [loadingState, setLoadingState] = useState<LoadingState>({ status: "PENDING" });
  const [report, setReport] = useState<VoxelyticsWorkflowReport | null>(null);
  // expandedMetaTaskKeys holds the meta tasks which should be expanded
  // in the left-side DAG. The right-side task listing will always show
  // all tasks (but in a hierarchical manner if meta tasks exist).
  const [expandedMetaTaskKeys, setExpandedMetaTaskKeys] = useState<Record<string, boolean>>({});

  const handleToggleExpandedMetaTaskKey = (metaTaskKey: string) => {
    const newExpandedMetaTaskKeys = { ...expandedMetaTaskKeys };
    newExpandedMetaTaskKeys[metaTaskKey] = !expandedMetaTaskKeys[metaTaskKey];

    // Since meta tasks can be nested, the order of the meta task keys
    // is relevant when "expanding" the DAG. Therefore, we make sure
    // that nested meta tasks come after the high-level meta tasks.
    const sortedKeys = Object.fromEntries(
      _.sortBy(
        Array.from(Object.entries(newExpandedMetaTaskKeys)),
        ([key]) => key.split("@").length,
      ),
    );
    setExpandedMetaTaskKeys(sortedKeys);
  };

  async function loadData() {
    try {
      setLoadingState({ status: "LOADING" });
      let _report = parseReport(await getVoxelyticsWorkflow(workflowName, null));
      if (metatask != null) {
        // If a meta task is passed via a GET parameter,
        // the entire report is filtered so that only the tasks of the given
        // meta task are shown (left-hand as well as right-hand side).
        _report = selectMetaTask(_report, metatask);
      }
      setReport(_report);
      setLoadingState({ status: "READY" });
    } catch (err) {
      try {
        const organization =
          user != null ? await isWorkflowAccessibleBySwitching(workflowName) : null;
        setLoadingState({
          status: "FAILED",
          organizationToSwitchTo: organization ?? undefined,
          error: err as Error,
        });
      } catch (accessibleBySwitchingError) {
        Toast.error("Could not load workflow report.");
        console.error(accessibleBySwitchingError);
        setLoadingState({ status: "FAILED", error: accessibleBySwitchingError as Error });
      }
    }
  }

  useEffect(() => {
    if (report != null) {
      const { metaTaskKeys } = getTasksWithHierarchy(report);
      setExpandedMetaTaskKeys((_expandedMetaTaskKeys) =>
        Object.fromEntries(
          metaTaskKeys.map((key) => [key, _expandedMetaTaskKeys[key] || key === metatask]),
        ),
      );
    }
  }, [report, metatask]);

  const collapsedReport = useMemo(
    () => (report != null ? collapseReport(report, expandedMetaTaskKeys) : null),
    [report, expandedMetaTaskKeys],
  );
  const tasksWithHierarchy = useMemo(
    () => (report != null ? getTasksWithHierarchy(report).tasksWithHierarchy : null),
    [report],
  );

  usePolling(
    loadData,
    // Only poll while the workflow is still running
    report == null || report.runs.some((run) => run.state === VoxelyticsRunState.RUNNING)
      ? VX_POLLING_INTERVAL
      : null,
  );

  if (loadingState.status === "FAILED" && user != null) {
    return (
      <BrainSpinnerWithError
        gotUnhandledError={false}
        organizationToSwitchTo={loadingState.organizationToSwitchTo}
        entity="workflow"
      />
    );
  }
  if (report == null || collapsedReport == null || tasksWithHierarchy == null) {
    return <BrainSpinner />;
  }

  return (
    <div className="container voxelytics-view">
      <TabTitle title={`${collapsedReport.workflow.name} | WEBKNOSSOS`} />
      <TaskListView
        report={collapsedReport}
        tasksWithHierarchy={tasksWithHierarchy}
        expandedMetaTaskKeys={expandedMetaTaskKeys}
        onToggleExpandedMetaTaskKey={handleToggleExpandedMetaTaskKey}
        openMetatask={metatask}
        onReload={loadData}
        isLoading={loadingState.status === "LOADING"}
      />
    </div>
  );
}

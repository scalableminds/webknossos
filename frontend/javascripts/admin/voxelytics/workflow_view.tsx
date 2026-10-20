import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { isWorkflowAccessibleBySwitching } from "admin/api/organization";
import { getVoxelyticsWorkflow } from "admin/rest_api";
import BrainSpinner, { BrainSpinnerWithError } from "components/brain_spinner";
import { useSearchParams, useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo } from "react";
import { useParams } from "react-router";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import TabTitle from "viewer/view/components/tab_title_component";
import { filterReportToMetaTask, getTasksWithHierarchy } from "./task_hierarchy";
import { useDagMetaTaskExpansion } from "./task_hierarchy_hooks";
import TaskListView from "./task_list_view";
import { VX_POLLING_INTERVAL } from "./utils";

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

export default function WorkflowView() {
  const { workflowHash = "", runId } = useParams();
  const { metatask } = useSearchParams();
  const user = useWkSelector((state) => state.activeUser);

  // If a meta task is passed via a URL parameter, the entire report is filtered so that only the
  // tasks of the given meta task are shown (left-hand as well as right-hand side).
  // Memoized, because react-query re-runs select (creating a new report) whenever it changes.
  const selectReport = useCallback(
    (data: VoxelyticsWorkflowReport) => {
      const parsedReport = parseReport(data);
      return metatask != null ? filterReportToMetaTask(parsedReport, metatask) : parsedReport;
    },
    [metatask],
  );

  const {
    data: report,
    isFetching: isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["voxelyticsWorkflow", workflowHash, runId],
    queryFn: async () => await getVoxelyticsWorkflow(workflowHash, runId ?? null),
    select: selectReport,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data == null || data.runs.some((run) => run.state === VoxelyticsRunState.RUNNING)
        ? (VX_POLLING_INTERVAL ?? false)
        : false;
    },
    staleTime: 0, // disable caching
    gcTime: 0, // disable garbage collection
    retry: false,
    placeholderData: keepPreviousData,
  });

  const { data: accessibleOrganization } = useQuery({
    queryKey: ["voxelyticsWorkflowAccess", workflowHash],
    queryFn: () => isWorkflowAccessibleBySwitching(workflowHash),
    enabled: isError && user != null,
  });

  // The DAG collapses meta tasks, while the task list always shows all tasks
  // (in a hierarchical manner if meta tasks exist).
  const { collapsedReport, isMetaTaskExpanded, toggleMetaTask } = useDagMetaTaskExpansion(
    report,
    metatask,
  );
  const tasksWithHierarchy = useMemo(
    () => (report != null ? getTasksWithHierarchy(report, metatask) : null),
    [report, metatask],
  );

  if (isError && user != null) {
    return (
      <BrainSpinnerWithError
        gotUnhandledError={false}
        organizationToSwitchTo={accessibleOrganization ?? undefined}
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
        isMetaTaskExpandedInDag={isMetaTaskExpanded}
        onToggleMetaTaskInDag={toggleMetaTask}
        openMetatask={metatask}
        runId={runId ?? null}
        onReload={refetch}
        isLoading={isLoading}
      />
    </div>
  );
}

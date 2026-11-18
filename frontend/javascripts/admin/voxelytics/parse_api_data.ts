import {
  type VoxelyticsChunkStatistics,
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
  type VoxelyticsWorkflowListing,
  type VoxelyticsWorkflowListingRun,
  type VoxelyticsWorkflowReport,
} from "types/api_types";

// The REST API delivers timestamps as strings or numbers. The functions in this module turn them
// into Dates and derive the structures (e.g., the DAG) which the views work with.

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

export function parseDag(
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

export function parseReport(report: VoxelyticsWorkflowReport): VoxelyticsWorkflowReport {
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

function parseRunInfo(runInfo: VoxelyticsWorkflowListingRun) {
  return {
    ...runInfo,
    beginTime: runInfo.beginTime != null ? new Date(runInfo.beginTime) : null,
    endTime: runInfo.endTime != null ? new Date(runInfo.endTime) : null,
  };
}

export function parseWorkflowInfo(
  workflowInfo: VoxelyticsWorkflowListing,
): VoxelyticsWorkflowListing {
  return {
    ...workflowInfo,
    runs: workflowInfo.runs.map(parseRunInfo).sort((a, b) => {
      if (a.beginTime != null && b.beginTime != null)
        return a.beginTime.getTime() - b.beginTime.getTime();
      else if (a.beginTime != null) return -1;
      else if (b.beginTime != null) return 1;
      else return 0;
    }),
  };
}

export function parseStatistics(row: VoxelyticsChunkStatistics): VoxelyticsChunkStatistics {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (key === "executionId") {
        return [key, value];
      } else if (value == null) {
        return [key, null];
      } else if (key === "beginTime" || key === "endTime") {
        return [key, new Date(value as string)];
      } else {
        return [key, value];
      }
    }),
  ) as VoxelyticsChunkStatistics;
}

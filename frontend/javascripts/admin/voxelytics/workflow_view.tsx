import _ from "lodash";
import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { LeftOutlined } from "@ant-design/icons";
import { Layout, message } from "antd";
import usePolling from "libs/polling";
import { VoxelyticsRunState, VoxelyticsWorkflowReport } from "types/api_flow_types";
import { useSearchParams } from "libs/react_hooks";
import { formatDate } from "../utils/helpers";
import { TaskListView } from "./task_list_view";

export type WorkflowDagEdge = { source: string; target: string; label: string };
export type WorkflowDagNode = {
  id: string;
  label: string;
  state: VoxelyticsRunState;
  isMetaTask?: boolean;
};
export type WorkflowDag = {
  edges: Array<WorkflowDagEdge>;
  nodes: Array<WorkflowDagNode>;
};

function lexicographicalTopologicalSort(
  nodes: Array<WorkflowDagNode>,
  edges: Array<WorkflowDagEdge>,
): Array<WorkflowDagNode> {
  // See https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm
  const output: Array<WorkflowDagNode> = [];
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

function parseDag(tasks: Record<string, TaskConfig>, run: RunInfo): WorkflowDag {
  const dag: WorkflowDag = {
    nodes: [],
    edges: [],
  };

  for (const [taskName, task] of Object.entries(tasks)) {
    dag.nodes.push({
      id: taskName,
      label: taskName,
      state: run.tasks.find((t) => t.taskName === taskName)?.state ?? VoxelyticsRunState.PENDING,
      isMetaTask: task.isMetaTask,
    });
    for (const [key, input] of Object.entries(task.inputs)) {
      const parseInput = (input: string | Record<string, string>, key: string) => {
        if (typeof input === "string") {
          if (input.includes(":")) {
            const [sourceTask] = input.split(":");
            dag.edges.push({
              source: sourceTask,
              target: taskName,
              label: key,
            });
          }
        } else if (input != null) {
          for (const [subKey, subInput] of Object.entries(input)) {
            parseInput(subInput, `${key}.${subKey}`);
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

function parseReport(report: WorkflowReport): WorkflowReport {
  const dag = parseDag(report.config.tasks, report.run);
  return {
    ...report,
    config: {
      ...report.config,
      tasks: Object.fromEntries(dag.nodes.map((t) => [t.id, report.config.tasks[t.id]])),
    },
    dag,
    run: {
      ...report.run,
      tasks: report.run.tasks.map(
        (t) =>
          ({
            ...t,
            beginTime: t.beginTime != null ? new Date(t.beginTime) : null,
            endTime: t.endTime != null ? new Date(t.endTime) : null,
            state: t.state,
          } as TaskInfo),
      ),
    },
  };
}

function getTasksWithHierarchy(report: WorkflowReport): {
  tasksWithHierarchy: Array<TaskConfigWithHierarchy>;
  metaTaskKeys: Array<string>;
  allTasks: Array<TaskConfigWithName>;
} {
  // Returns
  // - allTasks (~ report.config.tasks, but as an array instead of an object)
  // - metaTaskKeys (all keys of meta tasks)
  // - tasksWithHierarchy (a hierarchical structure which reflects the meta task hierarchy)
  const tasksWithHierarchy: Array<TaskConfigWithHierarchy> = [];
  const subTasksByKey: Record<string, Array<TaskConfigWithHierarchy>> = {};
  const allTasks: Array<TaskConfigWithName> = Object.keys(report.config.tasks).map((key) => ({
    ...report.config.tasks[key],
    taskName: key,
  }));
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
  report: WorkflowReport,
  expandedKeys: Record<string, boolean>,
): WorkflowReport {
  // Given a report and an array of meta task keys which should be collapsed
  // this function adapts nodes and edges of the given dag so that
  // tasks that belong to the specified meta tasks are collapsed into single
  // nodes (one node per meta task).
  const newNodesDict: Record<string, WorkflowDagNode> = {};

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

  const newEdgesDict: Record<string, WorkflowDagEdge> = {};
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

function selectMetaTask(report: WorkflowReport, selectedMetaTask: string): WorkflowReport {
  // If the GET parameter `metatask` is set, the report
  // is filtered so that only tasks which belong to the specified meta task
  // are shown.

  const newNodesDict: Record<string, WorkflowDagNode> = {};
  for (const node of report.dag.nodes) {
    if (node.id.startsWith(selectedMetaTask)) {
      newNodesDict[node.id] = node;
    }
  }

  const newNodes = Array.from(Object.values(newNodesDict));

  const newEdges: Array<WorkflowDagEdge> = [];
  for (const edge of report.dag.edges) {
    if (edge.source.startsWith(selectedMetaTask) && edge.target.startsWith(selectedMetaTask)) {
      newEdges.push(edge);
    }
  }

  const newTasks = Object.fromEntries(
    Object.entries(report.config.tasks).filter(([key, task]) => key.startsWith(selectedMetaTask)),
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
  const { runId, metatask } = useSearchParams();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [report, setReport] = useState<VoxelyticsWorkflowReport | null>(null);
  const [docs, setDocs] = useState({});
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
      setIsLoading(true);
      const params = new URLSearchParams();
      if (runId != null) {
        params.append("runId", runId);
      }
      const url = `${BASE_URL}/api/voxelytics/workflows/${workflowName}?${params}`;
      const res = await fetch(url, {
        mode: "cors",
        headers: { "x-auth-token": AUTH_TOKEN },
      });
      let report = parseReport(await res.json());
      if (metatask != null) {
        // If a meta task is passed via a GET parameter,
        // the entire report is filtered so that only the tasks of the given
        // meta task are shown (left-hand as well as right-hand side).
        report = selectMetaTask(report, metatask);
      }
      setReport(report);
    } catch (err) {
      console.error(err);
      message.error("Could not load workflow report.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (report != null) {
      const { metaTaskKeys } = getTasksWithHierarchy(report);
      setExpandedMetaTaskKeys((expandedMetaTaskKeys) =>
        Object.fromEntries(
          metaTaskKeys.map((key) => [key, expandedMetaTaskKeys[key] || key === metatask]),
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
    report == null || report.run.state === VoxelyticsRunState.RUNNING ? POLL_INTERVAL : null,
  );

  useEffect(() => {
    if (report?.config?.schema_version == null) return;

    const baseUrl = "https://static.voxelytics.com/plots";
    const url = `${baseUrl}/docs_${report.config.schema_version}-v2.json`;

    (async () => {
      const res = await fetch(url, { mode: "cors" });
      if (res.ok) {
        const docs = await res.json();
        setDocs(docs);
      }
    })();
  }, [report?.config?.schema_version]);

  if (report == null || collapsedReport == null || tasksWithHierarchy == null) {
    return <div style={{ color: "black", textAlign: "center" }}>Loading...</div>;
  }

  const {
    workflow: { name: readableWorkflowName, hash: workflowHash },
    run: { beginTime: runBeginTimeString },
  } = report;

  return (
    <>
      <Header workflowHash={workflowHash}>
        <Link to="/workflows">
          <LeftOutlined />
        </Link>{" "}
        {readableWorkflowName}
        <span style={{ color: "#51686e" }}>{` ${formatDate(new Date(runBeginTimeString))}`}</span>
      </Header>
      <Layout.Content
        style={{
          padding: 24,
        }}
      >
        <TaskListView
          report={collapsedReport}
          docs={docs}
          tasksWithHierarchy={tasksWithHierarchy}
          expandedMetaTaskKeys={expandedMetaTaskKeys}
          onToggleExpandedMetaTaskKey={handleToggleExpandedMetaTaskKey}
          openMetatask={metatask}
          onReload={loadData}
          isLoading={isLoading}
        />
      </Layout.Content>
    </>
  );
}

import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfigWithHierarchy,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
  type VoxelyticsWorkflowReport,
} from "types/api_types";

// Tasks are grouped into (possibly nested) meta tasks by their names: The task "a@b@c" belongs to
// the meta task "a@b", which itself belongs to the meta task "a".

// Returns the keys of all meta tasks containing the task, outermost first
// (e.g., ["a", "a@b"] for "a@b@c").
export function getMetaTaskAncestors(taskName: string): Array<string> {
  const parts = taskName.split("@");
  return parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("@"));
}

export function isInMetaTask(taskName: string, metaTaskKey: string): boolean {
  return taskName.startsWith(`${metaTaskKey}@`);
}

// All (nested) collapses of the task list share the expanded keys as their activeKey, so a collapse
// reports the keys of the other collapses, too. Only its own keys are taken over; otherwise, the
// keys of the other collapses would be duplicated with every change.
export function mergeActiveKeysOfCollapse(
  expandedKeys: Array<string>,
  collapseKeys: Array<string>,
  activeKeys: string | Array<string>,
): Array<string> {
  const newKeys = Array.isArray(activeKeys) ? activeKeys : [activeKeys];
  return [
    ...expandedKeys.filter((key) => !collapseKeys.includes(key)),
    ...newKeys.filter((key) => collapseKeys.includes(key)),
  ];
}

// Builds the meta task hierarchy, keeping the order of the tasks in the report. If a root meta
// task is given (the meta task opened in the extra view), it is the top level of the hierarchy.
export function getTasksWithHierarchy(
  report: VoxelyticsWorkflowReport,
  rootMetaTask: string | null = null,
): Array<VoxelyticsTaskConfigWithHierarchy> {
  const tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy> = [];
  const subtasksByKey: Record<string, Array<VoxelyticsTaskConfigWithHierarchy>> = {};

  // Returns the list a task with the given ancestors belongs to. Missing meta tasks are created.
  const getSiblings = (ancestors: Array<string>): Array<VoxelyticsTaskConfigWithHierarchy> => {
    if (ancestors.length === 0) return tasksWithHierarchy;
    const key = ancestors[ancestors.length - 1];
    if (subtasksByKey[key] == null) {
      subtasksByKey[key] = [];
      getSiblings(ancestors.slice(0, -1)).push({
        isMetaTask: true,
        key,
        subtasks: subtasksByKey[key],
      });
    }
    return subtasksByKey[key];
  };

  for (const [taskName, task] of Object.entries(report.config.tasks)) {
    const taskWithName: VoxelyticsTaskConfigWithName = { ...task, taskName };
    const ancestors = getMetaTaskAncestors(taskName).filter(
      (key) => rootMetaTask == null || key === rootMetaTask || isInMetaTask(key, rootMetaTask),
    );
    getSiblings(ancestors).push(taskWithName);
  }
  return tasksWithHierarchy;
}

// Collapses all tasks of meta tasks which are not expanded into a single DAG node per meta task.
// A task is collapsed into its outermost collapsed meta task.
export function collapseMetaTasksInDag(
  report: VoxelyticsWorkflowReport,
  isMetaTaskExpanded: (metaTaskKey: string) => boolean,
): VoxelyticsWorkflowReport {
  const getCollapsedId = (id: string) =>
    getMetaTaskAncestors(id).find((key) => !isMetaTaskExpanded(key)) ?? id;

  const newNodesDict: Record<string, VoxelyticsWorkflowDagNode> = {};
  for (const node of report.dag.nodes) {
    const collapsedId = getCollapsedId(node.id);
    newNodesDict[collapsedId] =
      collapsedId === node.id
        ? node
        : { ...node, id: collapsedId, label: collapsedId, isMetaTask: true };
  }

  const newEdgesDict: Record<string, VoxelyticsWorkflowDagEdge> = {};
  for (const edge of report.dag.edges) {
    const collapsedSource = getCollapsedId(edge.source);
    const collapsedTarget = getCollapsedId(edge.target);
    // Edges within the same collapsed meta task would become self-edges.
    if (collapsedSource !== collapsedTarget) {
      newEdgesDict[`${collapsedSource}-${collapsedTarget}`] = {
        ...edge,
        source: collapsedSource,
        target: collapsedTarget,
      };
    }
  }

  return {
    ...report,
    dag: {
      ...report.dag,
      nodes: Object.values(newNodesDict),
      edges: Object.values(newEdgesDict),
    },
  };
}

// Filters the report so that it only contains the tasks of the given meta task.
export function filterReportToMetaTask(
  report: VoxelyticsWorkflowReport,
  metaTaskKey: string,
): VoxelyticsWorkflowReport {
  return {
    ...report,
    config: {
      ...report.config,
      tasks: Object.fromEntries(
        Object.entries(report.config.tasks).filter(([key]) => isInMetaTask(key, metaTaskKey)),
      ),
    },
    dag: {
      ...report.dag,
      nodes: report.dag.nodes.filter((node) => isInMetaTask(node.id, metaTaskKey)),
      edges: report.dag.edges.filter(
        (edge) => isInMetaTask(edge.source, metaTaskKey) && isInMetaTask(edge.target, metaTaskKey),
      ),
    },
  };
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

function getMetaTaskInfo(
  metaTaskKey: string,
  subtaskInfos: Array<VoxelyticsTaskInfo>,
): VoxelyticsTaskInfo {
  if (subtaskInfos.length === 0) {
    return {
      taskName: metaTaskKey,
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

  if (subtaskInfos.every((t) => t.state === VoxelyticsRunState.SKIPPED)) {
    state = VoxelyticsRunState.SKIPPED;
  } else if (
    subtaskInfos.every(
      (t) => t.state === VoxelyticsRunState.PENDING || t.state === VoxelyticsRunState.SKIPPED,
    )
  ) {
    state = VoxelyticsRunState.PENDING;
  } else if (
    subtaskInfos.every(
      (t) => t.state === VoxelyticsRunState.COMPLETE || t.state === VoxelyticsRunState.SKIPPED,
    )
  ) {
    state = VoxelyticsRunState.COMPLETE;
    [beginTime, endTime] = aggregateTimes(subtaskInfos);
  } else if (subtaskInfos.some((t) => t.state === VoxelyticsRunState.RUNNING)) {
    state = VoxelyticsRunState.RUNNING;
    const runningOrCompletedTasks = subtaskInfos
      .slice(0, subtaskInfos.findIndex((t) => t.state === VoxelyticsRunState.RUNNING) + 1)
      .filter((t) => [VoxelyticsRunState.COMPLETE, VoxelyticsRunState.RUNNING].includes(t.state));
    [beginTime, endTime] = aggregateTimes(runningOrCompletedTasks);
  } else {
    if (subtaskInfos.some((t) => t.state === VoxelyticsRunState.STALE)) {
      state = VoxelyticsRunState.STALE;
    } else if (subtaskInfos.some((t) => t.state === VoxelyticsRunState.CANCELLED)) {
      state = VoxelyticsRunState.CANCELLED;
    } else {
      state = VoxelyticsRunState.FAILED;
    }
    const finishedTasks = subtaskInfos.filter((t) =>
      [
        VoxelyticsRunState.COMPLETE,
        VoxelyticsRunState.CANCELLED,
        VoxelyticsRunState.FAILED,
      ].includes(t.state),
    );
    [beginTime, endTime] = aggregateTimes(finishedTasks);
  }

  return {
    taskName: metaTaskKey,
    state,
    beginTime,
    endTime,
    currentExecutionId: null,
    chunkCounts: {
      total: subtaskInfos.reduce((r, a) => r + a.chunkCounts.total, 0),
      failed: subtaskInfos.reduce((r, a) => r + a.chunkCounts.failed, 0),
      skipped: subtaskInfos.reduce((r, a) => r + a.chunkCounts.skipped, 0),
      complete: subtaskInfos.reduce((r, a) => r + a.chunkCounts.complete, 0),
      cancelled: subtaskInfos.reduce((r, a) => r + a.chunkCounts.cancelled, 0),
    },
    runs: [],
  } as VoxelyticsTaskInfo;
}

function getTaskInfo(
  taskName: string,
  allTaskInfos: Array<VoxelyticsTaskInfo>,
  runId: string | null,
): VoxelyticsTaskInfo {
  const taskInfo = allTaskInfos.find((t) => t.taskName === taskName) as VoxelyticsTaskInfo;
  if (taskInfo === undefined) {
    throw new Error(`Task info not found for task ${taskName}.`);
  }

  if (runId != null) {
    const taskRun = taskInfo.runs.find((tr) => tr.runId === runId);
    if (taskRun === undefined) {
      throw new Error(
        `Task run ${runId} not found for task ${taskName}. Task might be from a different VX report.`,
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

// Returns the task infos of all tasks and meta tasks (by task name or meta task key). If a run is
// selected, the infos refer to that run. Meta task infos are aggregated from their subtasks.
export function getTaskInfosWithHierarchy(
  tasksWithHierarchy: Array<VoxelyticsTaskConfigWithHierarchy>,
  allTaskInfos: Array<VoxelyticsTaskInfo>,
  runId: string | null,
): Map<string, VoxelyticsTaskInfo> {
  const taskInfos = new Map<string, VoxelyticsTaskInfo>();
  const visit = (task: VoxelyticsTaskConfigWithHierarchy): VoxelyticsTaskInfo => {
    const taskInfo = task.isMetaTask
      ? getMetaTaskInfo(task.key, task.subtasks.map(visit))
      : getTaskInfo(task.taskName, allTaskInfos, runId);
    taskInfos.set(task.isMetaTask ? task.key : task.taskName, taskInfo);
    return taskInfo;
  };
  tasksWithHierarchy.forEach(visit);
  return taskInfos;
}

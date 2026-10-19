import {
  collapseMetaTasksInDag,
  filterReportToMetaTask,
  getMetaTaskAncestors,
  getTaskInfosWithHierarchy,
  getTasksWithHierarchy,
  isInMetaTask,
  mergeActiveKeysOfCollapse,
} from "admin/voxelytics/task_hierarchy";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfig,
  type VoxelyticsTaskConfigWithHierarchy,
  type VoxelyticsTaskInfo,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import { describe, expect, it } from "vitest";

const chunkCounts = { total: 1, failed: 0, skipped: 0, complete: 1, cancelled: 0 };

function makeTaskConfig(task: string): VoxelyticsTaskConfig {
  return {
    isMetaTask: undefined,
    config: { name: task },
    inputs: {},
    description: null,
    distribution: null,
    output_paths: null,
    task,
  };
}

// Builds a report with a linear DAG along the given task names.
function makeReport(taskNames: Array<string>): VoxelyticsWorkflowReport {
  return {
    config: {
      config: null,
      git_hash: null,
      global_parameters: {},
      paths: [],
      schema_version: 1,
      tasks: Object.fromEntries(taskNames.map((name) => [name, makeTaskConfig(name)])),
    },
    dag: {
      nodes: taskNames.map((id) => ({ id, label: id, state: VoxelyticsRunState.COMPLETE })),
      edges: taskNames
        .slice(1)
        .map((target, i) => ({ source: taskNames[i], target, label: "input" })),
    },
    artifacts: {},
    runs: [],
    tasks: [],
    workflow: { name: "workflow", hash: "hash", yamlContent: "" },
  };
}

// Simplifies the hierarchy to names for readable assertions.
function toNames(tasks: Array<VoxelyticsTaskConfigWithHierarchy>): Array<unknown> {
  return tasks.map((task) =>
    task.isMetaTask ? { [task.key]: toNames(task.subtasks) } : task.taskName,
  );
}

describe("getMetaTaskAncestors", () => {
  it("returns the containing meta tasks, outermost first", () => {
    expect(getMetaTaskAncestors("a@b@c")).toEqual(["a", "a@b"]);
    expect(getMetaTaskAncestors("a")).toEqual([]);
  });
});

describe("isInMetaTask", () => {
  it("only matches tasks inside the meta task, not tasks sharing its prefix", () => {
    expect(isInMetaTask("segment@predict", "segment")).toBe(true);
    expect(isInMetaTask("segment@postprocess@mesh", "segment")).toBe(true);
    expect(isInMetaTask("segmentation", "segment")).toBe(false);
    expect(isInMetaTask("segment", "segment")).toBe(false);
  });
});

describe("getTasksWithHierarchy", () => {
  it("nests tasks into meta tasks in report order", () => {
    const report = makeReport(["download", "a@x", "a@b@c", "a@b@d", "export"]);
    expect(toNames(getTasksWithHierarchy(report))).toEqual([
      "download",
      { a: ["a@x", { "a@b": ["a@b@c", "a@b@d"] }] },
      "export",
    ]);
  });

  it("creates parent meta tasks which only contain meta tasks", () => {
    const report = makeReport(["a@b@c"]);
    expect(toNames(getTasksWithHierarchy(report))).toEqual([{ a: [{ "a@b": ["a@b@c"] }] }]);
  });
});

describe("getTasksWithHierarchy with a root meta task", () => {
  it("makes the meta task opened in the extra view the top level", () => {
    const report = filterReportToMetaTask(makeReport(["download", "a@x", "a@b@c", "a@b@d"]), "a@b");
    expect(toNames(getTasksWithHierarchy(report, "a@b"))).toEqual([{ "a@b": ["a@b@c", "a@b@d"] }]);
  });
});

describe("collapseMetaTasksInDag", () => {
  const report = makeReport(["download", "a@x", "a@b@c", "segmentation"]);

  it("collapses tasks into their outermost collapsed meta task without self-edges", () => {
    const { dag } = collapseMetaTasksInDag(report, () => false);
    expect(dag.nodes.map((n) => [n.id, n.isMetaTask ?? false])).toEqual([
      ["download", false],
      ["a", true],
      ["segmentation", false],
    ]);
    expect(dag.edges.map((e) => `${e.source}-${e.target}`)).toEqual([
      "download-a",
      "a-segmentation",
    ]);
  });

  it("only collapses nested meta tasks which are not expanded", () => {
    const { dag } = collapseMetaTasksInDag(report, (key) => key === "a");
    expect(dag.nodes.map((n) => n.id)).toEqual(["download", "a@x", "a@b", "segmentation"]);
  });

  it("doesn't collapse tasks which only share the meta task's prefix", () => {
    const { dag } = collapseMetaTasksInDag(
      makeReport(["segment@predict", "segmentation"]),
      () => false,
    );
    expect(dag.nodes.map((n) => n.id)).toEqual(["segment", "segmentation"]);
  });
});

describe("filterReportToMetaTask", () => {
  it("keeps only the tasks, nodes and edges of the meta task", () => {
    const report = makeReport(["download", "a@x", "a@b@c", "ab"]);
    const filtered = filterReportToMetaTask(report, "a");
    expect(Object.keys(filtered.config.tasks)).toEqual(["a@x", "a@b@c"]);
    expect(filtered.dag.nodes.map((n) => n.id)).toEqual(["a@x", "a@b@c"]);
    expect(filtered.dag.edges.map((e) => `${e.source}-${e.target}`)).toEqual(["a@x-a@b@c"]);
  });
});

describe("getTaskInfosWithHierarchy", () => {
  function makeTaskInfo(
    taskName: string,
    state: VoxelyticsRunState.COMPLETE | VoxelyticsRunState.FAILED,
    beginTime: number,
  ): VoxelyticsTaskInfo {
    return {
      taskName,
      currentExecutionId: null,
      chunkCounts,
      state,
      beginTime: new Date(beginTime),
      endTime: new Date(beginTime + 100),
      runs: [
        {
          runId: "run",
          currentExecutionId: null,
          chunkCounts,
          state: VoxelyticsRunState.SKIPPED,
          beginTime: null,
          endTime: null,
        },
      ],
    };
  }

  const report = makeReport(["a@x", "a@b@c"]);
  const tasksWithHierarchy = getTasksWithHierarchy(report);
  const allTaskInfos = [
    makeTaskInfo("a@x", VoxelyticsRunState.COMPLETE, 1000),
    makeTaskInfo("a@b@c", VoxelyticsRunState.FAILED, 2000),
  ];

  it("aggregates nested meta tasks from their subtasks", () => {
    const taskInfos = getTaskInfosWithHierarchy(tasksWithHierarchy, allTaskInfos, null);
    expect(taskInfos.get("a@b")?.state).toBe(VoxelyticsRunState.FAILED);
    expect(taskInfos.get("a")?.state).toBe(VoxelyticsRunState.FAILED);
    expect(taskInfos.get("a")?.beginTime).toEqual(new Date(1000));
    expect(taskInfos.get("a")?.endTime).toEqual(new Date(2100));
    expect(taskInfos.get("a")?.chunkCounts.total).toBe(2);
  });

  it("uses the task runs of the selected run", () => {
    const taskInfos = getTaskInfosWithHierarchy(tasksWithHierarchy, allTaskInfos, "run");
    expect(taskInfos.get("a@x")?.state).toBe(VoxelyticsRunState.SKIPPED);
    expect(taskInfos.get("a")?.state).toBe(VoxelyticsRunState.SKIPPED);
  });
});

describe("mergeActiveKeysOfCollapse", () => {
  const topLevelKeys = ["a", "b"];
  const nestedKeys = ["a@x", "a@y"];

  it("only takes over the keys of the changed collapse", () => {
    // The nested collapse reports the shared active keys, including "a" of the top-level collapse.
    const expandedKeys = mergeActiveKeysOfCollapse(["a"], nestedKeys, ["a", "a@x"]);
    expect(expandedKeys).toEqual(["a", "a@x"]);
  });

  it("keeps the keys of other collapses when collapsing a panel", () => {
    // Collapsing "a" in the top-level collapse.
    expect(mergeActiveKeysOfCollapse(["a", "a@x"], topLevelKeys, ["a@x"])).toEqual(["a@x"]);
  });
});

// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import { resetDatabase, setUserAuthToken, tokenUserA, tokenUserFInOrgaY } from "test/e2e_setup";
import {
  deleteWorkflow,
  getVoxelyticsArtifactChecksums,
  getVoxelyticsChunkStatistics,
  getVoxelyticsWorkflow,
  getVoxelyticsWorkflows,
} from "admin/rest_api";
import { parseReport, parseStatistics, parseWorkflowInfo } from "admin/voxelytics/parse_api_data";
import sortBy from "lodash-es/sortBy";
import {
  VoxelyticsRunState,
  type VoxelyticsWorkflowListing,
  type VoxelyticsWorkflowReport,
} from "types/api_types";
import { afterEach, beforeAll, describe, it } from "vitest";

// Seeded via test/db/voxelytics_*.csv
const inferenceWorkflowHash = "979252d3f3";
const multiRunWorkflowHash = "synthruns01";
const metaTaskWorkflowHash = "synthmeta01";
const failedRerunId = "6ad1d0e6f78084a048e5515e";

// The workflow listing is not sorted by the backend.
function withStableListingOrder(workflows: Array<VoxelyticsWorkflowListing>) {
  return sortBy(workflows, "hash").map((workflow) => ({
    ...workflow,
    runs: sortBy(workflow.runs, "id"),
  }));
}

// The backend sorts task runs by beginTime only, so the order of runs without a beginTime
// (e.g. SKIPPED ones) depends on the database and is not stable across test runs.
function withStableTaskRunOrder(report: VoxelyticsWorkflowReport): VoxelyticsWorkflowReport {
  return {
    ...report,
    tasks: report.tasks.map((task) => ({
      ...task,
      runs: [
        ...task.runs.filter((run) => run.beginTime != null),
        ...sortBy(
          task.runs.filter((run) => run.beginTime == null),
          "runId",
        ),
      ],
    })),
  };
}

// Aggregates like stddev are computed by Postgres and can differ in the last digits
// between machines.
function withRoundedFloats<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === "number" && !Number.isInteger(entry) ? Number(entry.toPrecision(10)) : entry,
    ),
  );
}

describe("Voxelytics API (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  afterEach(async () => {
    setUserAuthToken(tokenUserA);
  });

  it("getVoxelyticsWorkflows()", async ({ expect }) => {
    const workflows = await getVoxelyticsWorkflows();

    expect(workflows.map((workflow) => workflow.hash).sort()).toEqual([
      inferenceWorkflowHash,
      metaTaskWorkflowHash,
      multiRunWorkflowHash,
    ]);
    expect(withStableListingOrder(workflows)).toMatchSnapshot();
  });

  it("getVoxelyticsWorkflow() for the latest run", async ({ expect }) => {
    const report = await getVoxelyticsWorkflow(multiRunWorkflowHash, null);

    expect(report.runs).toHaveLength(5);
    expect(withStableTaskRunOrder(report)).toMatchSnapshot();
  });

  it("getVoxelyticsWorkflow() for a specific run", async ({ expect }) => {
    const report = await getVoxelyticsWorkflow(multiRunWorkflowHash, failedRerunId);

    expect(withStableTaskRunOrder(report)).toMatchSnapshot();
  });

  it("getVoxelyticsWorkflow() with nested meta tasks", async ({ expect }) => {
    const report = await getVoxelyticsWorkflow(metaTaskWorkflowHash, null);

    expect(withStableTaskRunOrder(report)).toMatchSnapshot();
  });

  it("getVoxelyticsWorkflow() with artifacts", async ({ expect }) => {
    const report = await getVoxelyticsWorkflow(inferenceWorkflowHash, null);

    expect(withStableTaskRunOrder(report)).toMatchSnapshot();
  });

  it("getVoxelyticsWorkflow() for an unknown run", async ({ expect }) => {
    await expect(
      getVoxelyticsWorkflow(multiRunWorkflowHash, "000000000000000000000000"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("getVoxelyticsChunkStatistics()", async ({ expect }) => {
    const statistics = await getVoxelyticsChunkStatistics(inferenceWorkflowHash, null, "predict");

    expect(statistics.length).toBeGreaterThan(0);
    expect(withRoundedFloats(statistics)).toMatchSnapshot();
  });

  it("getVoxelyticsArtifactChecksums()", async ({ expect }) => {
    const checksums = await getVoxelyticsArtifactChecksums(
      inferenceWorkflowHash,
      null,
      "import_model",
      "model",
    );

    expect(checksums).toEqual([]);
  });

  it("workflows are not visible to other organizations", async ({ expect }) => {
    setUserAuthToken(tokenUserFInOrgaY);

    expect(await getVoxelyticsWorkflows()).toEqual([]);
    await expect(getVoxelyticsWorkflow(multiRunWorkflowHash, null)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("deleteWorkflow()", async ({ expect }) => {
    await deleteWorkflow(inferenceWorkflowHash);

    const workflows = await getVoxelyticsWorkflows();
    expect(workflows.map((workflow) => workflow.hash).sort()).toEqual([
      metaTaskWorkflowHash,
      multiRunWorkflowHash,
    ]);
    await expect(getVoxelyticsWorkflow(inferenceWorkflowHash, null)).rejects.toMatchObject({
      status: 404,
    });
  });
});

// The API sends epoch milliseconds, although the types declare Dates for the parsed values.
function toExpectedDate(wireTime: unknown): Date | null {
  return wireTime == null ? null : new Date(wireTime as number);
}

describe("Parsing of Voxelytics API results (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  const reportsToParse: Array<[workflowHash: string, runId: string | null]> = [
    [inferenceWorkflowHash, null],
    [multiRunWorkflowHash, null],
    [multiRunWorkflowHash, failedRerunId],
    [metaTaskWorkflowHash, null],
  ];

  it.for(reportsToParse)(
    "parseReport() converts all timestamps of %s",
    async ([hash, runId], { expect }) => {
      const wireReport = await getVoxelyticsWorkflow(hash, runId);
      const report = parseReport(wireReport);

      expect(report.runs).toHaveLength(wireReport.runs.length);
      wireReport.runs.forEach((wireRun, i) => {
        expect(report.runs[i].beginTime).toEqual(toExpectedDate(wireRun.beginTime));
        expect(report.runs[i].endTime).toEqual(toExpectedDate(wireRun.endTime));
      });
      expect(report.tasks).toHaveLength(wireReport.tasks.length);
      wireReport.tasks.forEach((wireTask, i) => {
        expect(report.tasks[i].beginTime).toEqual(toExpectedDate(wireTask.beginTime));
        expect(report.tasks[i].endTime).toEqual(toExpectedDate(wireTask.endTime));
        wireTask.runs.forEach((wireTaskRun, j) => {
          expect(report.tasks[i].runs[j].beginTime).toEqual(toExpectedDate(wireTaskRun.beginTime));
          expect(report.tasks[i].runs[j].endTime).toEqual(toExpectedDate(wireTaskRun.endTime));
        });
      });
    },
  );

  it.for(reportsToParse)(
    "parseReport() derives a consistent dag for %s",
    async ([hash, runId], { expect }) => {
      const wireReport = await getVoxelyticsWorkflow(hash, runId);
      const report = parseReport(wireReport);
      const nodeIds = report.dag.nodes.map((node) => node.id);

      expect([...nodeIds].sort()).toEqual(Object.keys(wireReport.config.tasks).sort());
      expect(Object.keys(report.config.tasks)).toEqual(nodeIds);
      expect(report.dag.edges.length).toBeGreaterThan(0);
      for (const edge of report.dag.edges) {
        expect(nodeIds.indexOf(edge.source)).toBeGreaterThanOrEqual(0);
        expect(nodeIds.indexOf(edge.source)).toBeLessThan(nodeIds.indexOf(edge.target));
      }
      for (const node of report.dag.nodes) {
        const taskInfo = wireReport.tasks.find((task) => task.taskName === node.id);
        expect(node.state).toBe(taskInfo?.state ?? VoxelyticsRunState.PENDING);
      }
    },
  );

  it("parseReport() derives the dag edges from the task inputs", async ({ expect }) => {
    const report = parseReport(await getVoxelyticsWorkflow(multiRunWorkflowHash, null));

    expect(report.dag.nodes.map((node) => node.id)).toEqual([
      "download",
      "never_executed",
      "segment@predict",
      "segment@agglomerate",
      "export",
    ]);
    expect(sortBy(report.dag.edges, ["source", "target"])).toEqual([
      { source: "download", target: "never_executed", label: "data" },
      { source: "download", target: "segment@predict", label: "data" },
      { source: "segment@agglomerate", target: "export", label: "segmentation" },
      { source: "segment@predict", target: "segment@agglomerate", label: "probs" },
    ]);
  });

  it("parseReport() sorts the dag of nested meta tasks topologically", async ({ expect }) => {
    const report = parseReport(await getVoxelyticsWorkflow(metaTaskWorkflowHash, null));

    expect(report.dag.nodes.map((node) => node.id)).toEqual([
      "download",
      "segment@predict",
      "segment@postprocess@agglomerate",
      "export",
      "segment@postprocess@mesh",
    ]);
    expect(sortBy(report.dag.edges, ["source", "target"])).toEqual([
      { source: "download", target: "segment@predict", label: "data" },
      { source: "segment@postprocess@agglomerate", target: "export", label: "segmentation" },
      {
        source: "segment@postprocess@agglomerate",
        target: "segment@postprocess@mesh",
        label: "seg",
      },
      { source: "segment@predict", target: "segment@postprocess@agglomerate", label: "probs" },
    ]);
  });

  it("parseWorkflowInfo() converts the run times and sorts the runs by begin time", async ({
    expect,
  }) => {
    const wireWorkflows = await getVoxelyticsWorkflows();
    const workflows = wireWorkflows.map(parseWorkflowInfo);

    expect(workflows.find((workflow) => workflow.hash === multiRunWorkflowHash)?.runs).toHaveLength(
      5,
    );
    wireWorkflows.forEach((wireWorkflow, i) => {
      const { runs } = workflows[i];
      expect(runs).toHaveLength(wireWorkflow.runs.length);
      for (const run of runs) {
        const wireRun = wireWorkflow.runs.find((candidate) => candidate.id === run.id);
        expect(run.beginTime).toEqual(toExpectedDate(wireRun?.beginTime));
        expect(run.endTime).toEqual(toExpectedDate(wireRun?.endTime));
      }
      const beginTimes = runs.map((run) => run.beginTime?.getTime() ?? Number.POSITIVE_INFINITY);
      expect(beginTimes).toEqual([...beginTimes].sort((a, b) => a - b));
    });
  });

  it("parseStatistics() converts the begin and end time", async ({ expect }) => {
    const wireStatistics = await getVoxelyticsChunkStatistics(
      inferenceWorkflowHash,
      null,
      "predict",
    );
    const statistics = wireStatistics.map(parseStatistics);

    expect(statistics.length).toBeGreaterThan(0);
    wireStatistics.forEach((wireRow, i) => {
      // The backend omits null columns, so a missing time stays absent instead of becoming null.
      expect(statistics[i].beginTime ?? null).toEqual(toExpectedDate(wireRow.beginTime));
      expect(statistics[i].endTime ?? null).toEqual(toExpectedDate(wireRow.endTime));
      expect(statistics[i].executionId).toBe(wireRow.executionId);
      expect(statistics[i].chunkCounts).toEqual(wireRow.chunkCounts);
      expect(statistics[i].memory).toEqual(wireRow.memory);
    });
  });
});

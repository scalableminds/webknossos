// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import { resetDatabase, setUserAuthToken, tokenUserA, tokenUserFInOrgaY } from "test/e2e_setup";
import {
  deleteWorkflow,
  getVoxelyticsArtifactChecksums,
  getVoxelyticsChunkStatistics,
  getVoxelyticsWorkflow,
  getVoxelyticsWorkflows,
} from "admin/rest_api";
import sortBy from "lodash-es/sortBy";
import type { VoxelyticsWorkflowListing, VoxelyticsWorkflowReport } from "types/api_types";
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

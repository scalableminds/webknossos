import { getTaskExecutions } from "admin/voxelytics/task_runs_tab";
import {
  type VoxelyticsRunInfo,
  VoxelyticsRunState,
  type VoxelyticsTaskInfo,
} from "types/api_types";
import { describe, expect, it } from "vitest";

const chunkCounts = { total: 1, failed: 0, skipped: 0, complete: 1, cancelled: 0 };

function makeRun(id: string): VoxelyticsRunInfo {
  return {
    id,
    name: `run-${id}`,
    userName: "user",
    hostName: "host",
    voxelyticsVersion: "1.0.0",
    state: VoxelyticsRunState.COMPLETE,
    beginTime: new Date(0),
    endTime: new Date(1),
  };
}

describe("getTaskExecutions", () => {
  it("returns only runs that executed the task, most recent first", () => {
    const runs = ["a", "b", "c", "d"].map(makeRun);
    const taskRuns: VoxelyticsTaskInfo["runs"] = [
      {
        runId: "a",
        currentExecutionId: null,
        chunkCounts,
        state: VoxelyticsRunState.COMPLETE,
        beginTime: new Date(1000),
        endTime: new Date(2000),
      },
      {
        runId: "b",
        currentExecutionId: null,
        chunkCounts,
        state: VoxelyticsRunState.SKIPPED,
        beginTime: null,
        endTime: null,
      },
      {
        runId: "c",
        currentExecutionId: null,
        chunkCounts,
        state: VoxelyticsRunState.FAILED,
        beginTime: new Date(3000),
        endTime: new Date(4000),
      },
      {
        runId: "unknown",
        currentExecutionId: null,
        chunkCounts,
        state: VoxelyticsRunState.COMPLETE,
        beginTime: new Date(5000),
        endTime: new Date(6000),
      },
    ];

    const executions = getTaskExecutions(taskRuns, new Map(runs.map((run) => [run.id, run])));

    expect(executions.map(({ run }) => run.id)).toEqual(["c", "a"]);
  });
});

import { tokenUserA, setUserAuthToken, resetDatabase, writeTypeCheckingFile } from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import { describe, beforeAll, expect, it } from "vitest";
import type { APIAllowedMode } from "types/api_flow_types";

beforeAll(async () => {
  resetDatabase();
  setUserAuthToken(tokenUserA);
});

describe("Task Types API (E2E)", () => {
  it("getTaskTypes()", async () => {
    const taskTypes = await api.getTaskTypes();

    writeTypeCheckingFile(taskTypes, "task-type", "APITaskType", {
      isArray: true,
    });

    expect(taskTypes).toMatchSnapshot();
  });

  it("getTaskType()", async () => {
    const taskTypes = await api.getTaskTypes();
    const taskType = await api.getTaskType(taskTypes[0].id);

    expect(taskType).toMatchSnapshot();
  });

  it("createTaskType and deleteTaskType", async () => {
    const activeUser = await api.getActiveUser();
    const aTeam = activeUser.teams[0];
    const newTaskType = {
      id: null,
      summary: "summary",
      description: "description",
      teamId: aTeam.id,
      settings: {
        somaClickingAllowed: true,
        branchPointsAllowed: true,
        mergerMode: false,
        volumeInterpolationAllowed: false,
        allowedModes: ["orthogonal" as APIAllowedMode],
        magRestrictions: {},
      },
      recommendedConfiguration: null,
      tracingType: "skeleton" as const,
    };

    const createdTaskType = await api.createTaskType(newTaskType);
    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdTaskTypeWithFixedId = Object.assign({}, createdTaskType, {
      id: "fixed-id",
    });
    expect(createdTaskTypeWithFixedId).toMatchSnapshot();

    const response = await api.deleteTaskType(createdTaskType.id);
    expect(response).toMatchSnapshot();
  });

  it("updateTaskType()", async () => {
    const taskTypes = await api.getTaskTypes();
    const taskType = await api.getTaskType(taskTypes[0].id);
    const updatedTaskType = await api.updateTaskType(
      taskType.id,
      Object.assign({}, taskType, {
        summary: "new-test-summary",
      }),
    );
    expect(updatedTaskType).toMatchSnapshot();

    // Change back
    const revertedTaskType = await api.updateTaskType(taskType.id, taskType);
    expect(revertedTaskType).toMatchSnapshot();
  });
});

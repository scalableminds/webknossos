import {
  createTaskType,
  deleteTaskType,
  getActiveUser,
  getTaskType,
  getTaskTypes,
  updateTaskType,
} from "admin/rest_api";
import { resetDatabase, setUserAuthToken, tokenUserA, writeTypeCheckingFile } from "test/e2e-setup";
import type { APIAllowedMode } from "types/api_types";
import { beforeAll, describe, expect, it } from "vitest";

describe("Task Types API (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("getTaskTypes()", async () => {
    const taskTypes = await getTaskTypes();

    writeTypeCheckingFile(taskTypes, "task-type", "APITaskType", {
      isArray: true,
    });

    expect(taskTypes).toMatchSnapshot();
  });

  it("getTaskType()", async () => {
    const taskTypes = await getTaskTypes();
    const taskType = await getTaskType(taskTypes[0].id);

    expect(taskType).toMatchSnapshot();
  });

  it("createTaskType and deleteTaskType", async () => {
    const activeUser = await getActiveUser();
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

    const createdTaskType = await createTaskType(newTaskType);
    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdTaskTypeWithFixedId = Object.assign({}, createdTaskType, {
      id: "fixed-id",
    });
    expect(createdTaskTypeWithFixedId).toMatchSnapshot();

    const response = await deleteTaskType(createdTaskType.id);
    expect(response).toMatchSnapshot();
  });

  it("updateTaskType()", async () => {
    const taskTypes = await getTaskTypes();
    const taskType = await getTaskType(taskTypes[0].id);
    const updatedTaskType = await updateTaskType(
      taskType.id,
      Object.assign({}, taskType, {
        summary: "new-test-summary",
      }),
    );
    expect(updatedTaskType).toMatchSnapshot();

    // Change back
    const revertedTaskType = await updateTaskType(taskType.id, taskType);
    expect(revertedTaskType).toMatchSnapshot();
  });
});

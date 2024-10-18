import { tokenUserA, setCurrToken, resetDatabase, writeTypeCheckingFile } from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
import type { APIAllowedMode } from "types/api_flow_types";
test.before("Change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getTaskTypes()", async (t) => {
  const taskTypes = await api.getTaskTypes();
  writeTypeCheckingFile(taskTypes, "task-type", "APITaskType", {
    isArray: true,
  });
  t.snapshot(taskTypes);
});
test("getTaskType()", async (t) => {
  const taskTypes = await api.getTaskTypes();
  const taskType = await api.getTaskType(taskTypes[0].id);
  t.snapshot(taskType);
});
test("createTaskType and deleteTaskType", async (t) => {
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
  t.snapshot(createdTaskTypeWithFixedId);
  const response = await api.deleteTaskType(createdTaskType.id);
  t.snapshot(response);
});
test("updateTaskType()", async (t) => {
  const taskTypes = await api.getTaskTypes();
  const taskType = await api.getTaskType(taskTypes[0].id);
  const updatedTaskType = await api.updateTaskType(
    taskType.id,
    Object.assign({}, taskType, {
      summary: "new-test-summary",
    }),
  );
  t.snapshot(updatedTaskType);
  // Change back
  const revertedTaskType = await api.updateTaskType(taskType.id, taskType);
  t.snapshot(revertedTaskType);
});

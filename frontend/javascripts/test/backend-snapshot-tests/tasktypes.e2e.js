// @flow
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("getTaskTypes()", async t => {
  const taskTypes = await api.getTaskTypes();
  writeFlowCheckingFile(taskTypes, "task-type", "APITaskType", { isArray: true });
  t.snapshot(taskTypes, { id: "taskTypes-getTaskTypes" });
});

test("getTaskType()", async t => {
  const taskTypes = await api.getTaskTypes();
  const taskType = await api.getTaskType(taskTypes[0].id);
  t.snapshot(taskType, { id: "taskTypes-getTaskType" });
});

test("createTaskType and deleteTaskType", async t => {
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
      allowedModes: ["orthogonal"],
      resolutionRestrictions: {
        min: null,
        max: null,
      },
    },
    recommendedConfiguration: null,
    tracingType: "skeleton",
  };

  const createdTaskType = await api.createTaskType(newTaskType);
  // Since the id will change after re-runs, we fix it here for easy
  // snapshotting
  const createdTaskTypeWithFixedId = Object.assign({}, createdTaskType, { id: "fixed-id" });
  t.snapshot(createdTaskTypeWithFixedId, { id: "taskTypes-createdTaskType" });

  const response = await api.deleteTaskType(createdTaskType.id);
  t.snapshot(response, { id: "taskTypes-deleteTaskType" });
});

test("updateTaskType()", async t => {
  const taskTypes = await api.getTaskTypes();
  const taskType = await api.getTaskType(taskTypes[0].id);

  const updatedTaskType = await api.updateTaskType(
    taskType.id,
    Object.assign({}, taskType, { summary: "new-test-summary" }),
  );
  t.snapshot(updatedTaskType, { id: "taskTypes-updateTaskType" });

  // Change back
  const revertedTaskType = await api.updateTaskType(taskType.id, taskType);
  t.snapshot(revertedTaskType, { id: "taskTypes-revertedTaskType" });
});

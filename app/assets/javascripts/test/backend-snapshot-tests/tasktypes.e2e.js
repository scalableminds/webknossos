/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

test("getTaskTypes()", async t => {
  const taskTypes = await api.getTaskTypes();
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
    team: aTeam.team,
    settings: {
      somaClickingAllowed: true,
      branchPointsAllowed: true,
      advancedOptionsAllowed: true,
      allowedModes: ["orthogonal"],
    },
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

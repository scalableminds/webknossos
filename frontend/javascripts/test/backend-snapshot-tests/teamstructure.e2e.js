// @flow
import _ from "lodash";

import {
  tokenUserA,
  tokenUserB,
  tokenUserC,
  tokenUserD,
  tokenUserE,
  setCurrToken,
  resetDatabase,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Reset database", async () => {
  resetDatabase();
});

/*
TEAM STRUCTURE USED FOR TESTING:

Organizations:
Organization X, Organization Y

Teams:
team_X1, team_X2, team_X3, team_X4, team_Y1

User:
user_A, user_B, user_C, user_D, user_E

++----------------------------------------------------------------------------------------------------------------------++--------------------------------------++
||  Otganization X                                                                                                      ||  Organization Y                      ||
||  Admin: user_A                                                                                                       ||  Admin: user_E                       ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
|| team_X1                          |  team_X2                  |  team_X3                  |  team_X4                  ||  team_Y1                             ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
|| user_A (teamMng)                 |  user_D (teamMng.)        |  user_A                   |  user_A (teamMng.)        ||  user_E	(teamMng.)                  ||
|| user_B (teamMng.)                |                           |                           |                           ||                                      ||
|| user_C                           |                           |                           |                           ||                                      ||
++----------------------------------+---------------------------+---------------------------+---------------------------++--------------------------------------++
 */

// Teams
test("teams_userDefault", async t => {
  await setCurrToken(tokenUserA);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_X1");
  t.is(teams[1].name, "team_X2");
  t.is(teams[2].name, "team_X3");
  t.is(teams[3].name, "team_X4");
  t.is(teams.length, 4);
});

test("teams_user_D", async t => {
  await setCurrToken(tokenUserD);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_X2");
  t.is(teams.length, 1);
});

test("teams_user_E", async t => {
  await setCurrToken(tokenUserE);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_Y1");
  t.is(teams.length, 1);
});

test("teams_delete_user_D", async t => {
  // the teamManager is not allowed to delete the team
  await setCurrToken(tokenUserD);
  t.plan(1);

  await api.deleteTeam("69882b370d889b84020efd4f").catch(err => {
    t.is(err.messages[0].error, "Access denied. Only admin users can execute this operation.");
  });
});

test("teams_create_user_D", async t => {
  // the teamManager is not allowed to create a new team
  await setCurrToken(tokenUserD);
  t.plan(1);

  const newTeam = {
    name: "test-team-name",
  };
  await api.createTeam(newTeam).catch(err => {
    t.is(err.messages[0].error, "Access denied. Only admin users can execute this operation.");
  });
});

// TaskTypes
test("taskTypes_userDefault", async t => {
  await setCurrToken(tokenUserA);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes[0].description, "Check those cells out!");
  t.is(taskTypes.length, 2);
});

test("taskTypes_user_D", async t => {
  await setCurrToken(tokenUserD);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 1);
});

test("taskTypes_user_E", async t => {
  await setCurrToken(tokenUserE);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 0);
});

// Tasks
test("tasks_user_D", async t => {
  await setCurrToken(tokenUserD);
  t.plan(1);

  await api.getTask("58135c192faeb34c0081c058").catch(err => {
    t.is(err.messages[0].error, "Task couldn’t be found");
  });
});

test("tasks_user_E", async t => {
  await setCurrToken(tokenUserE);
  t.plan(1);

  await api.getTask("58135c192faeb34c0081c058").catch(err => {
    t.is(err.messages[0].error, "Task couldn’t be found");
  });
});

test("tasks_user_C", async t => {
  await setCurrToken(tokenUserC);
  const task = await api.getTask("58135c192faeb34c0081c058");
  t.is(task.id, "58135c192faeb34c0081c058");
});

// User
test("user_user_B", async t => {
  // teamMng are not allowed to de-/activate a user (if they are not an admin)
  await setCurrToken(tokenUserB);
  t.plan(2);

  const userIdC = "770b9f4d2a7c0e4d008da6ef";
  const user = await api.getUser(userIdC);
  t.is(user.firstName, "user_C");
  const newUser = Object.assign({}, user, { isActive: false });
  await api.updateUser(newUser).catch(err => {
    t.is(err.messages[0].error, "You are not authorized to view or edit this resource");
  });
});

// Project
test("project_user_B", async t => {
  // teamMng are not allowed to delete a project (if they are not an admin and they are not the owner)
  await setCurrToken(tokenUserE);
  t.plan(1);

  const projectName = "Test_Project";
  await api.deleteProject(projectName).catch(err => {
    t.is(err.messages[0].error, "Project Test_Project couldn’t be found");
  });
});

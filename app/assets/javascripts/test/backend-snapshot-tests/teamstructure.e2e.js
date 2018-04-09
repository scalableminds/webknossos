/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import {
  tokenUser_A,
  tokenUser_B,
  tokenUser_C,
  tokenUser_D,
  tokenUser_E,
  setCurrToken,
} from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

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
  await setCurrToken(tokenUser_A);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_X1");
  t.is(teams[1].name, "team_X2");
  t.is(teams[2].name, "team_X3");
  t.is(teams[3].name, "team_X4");
  t.is(teams.length, 4);
});

test("teams_user_D", async t => {
  await setCurrToken(tokenUser_D);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_X2");
  t.is(teams.length, 1);
});

test("teams_user_E", async t => {
  await setCurrToken(tokenUser_E);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_Y1");
  t.is(teams.length, 1);
});

test("teams_delete_user_D", async t => {
  // the teamManager is not allowed to delete the team
  await setCurrToken(tokenUser_D);
  try {
    await api.deleteTeam("69882b370d889b84020efd4f");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true); // not pretty, but "t.ok" seems to not exist
  }
});

test("teams_create_user_D", async t => {
  // the teamManager is not allowed to create a new team
  await setCurrToken(tokenUser_D);
  try {
    const organizations = await api.getOrganizations();
    const newTeam = {
      name: "test-team-name",
      organization: organizations[0].name,
    };
    await api.createTeam(newTeam);
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

// TaskTypes
test("taskTypes_userDefault", async t => {
  await setCurrToken(tokenUser_A);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes[0].description, "Check those cells out!");
  t.is(taskTypes.length, 1);
});

test("taskTypes_user_D", async t => {
  await setCurrToken(tokenUser_D);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 0);
});

test("taskTypes_user_E", async t => {
  await setCurrToken(tokenUser_E);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 0);
});

// Tasks
test("tasks_user_D", async t => {
  await setCurrToken(tokenUser_D);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_user_E", async t => {
  await setCurrToken(tokenUser_E);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_user_C", async t => {
  await setCurrToken(tokenUser_C);
  try {
    // the test is NOT supposed to fail
    await api.getTask("58135c192faeb34c0081c058");
    t.true(true);
  } catch (err) {
    t.fail();
  }
});

// User
test("user_user_B", async t => {
  // teamMng are not allowed to de-/activate a user (if they are not an admin)
  await setCurrToken(tokenUser_B);
  try {
    const userIdABA = "870b9f4d2a7c0e4d008da6ef";
    const user = await api.getUser(userIdABA);
    const newUser = Object.assign({}, user, { isActive: false });
    await api.updateUser(newUser);
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

// Project
test("project_user_B", async t => {
  // teamMng are not allowed to delete a project (if they are not an admin and they are not the owner)
  await setCurrToken(tokenUser_E);
  try {
    const projectName = "Test_Project";
    await api.deleteProject(projectName);
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

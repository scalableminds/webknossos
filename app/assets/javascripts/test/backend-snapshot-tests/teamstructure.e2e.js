/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import {
  tokenUserDefault,
  tokenUserAAB,
  tokenUserAAC,
  tokenUserABA,
  tokenUserBAA,
  setCurrToken,
} from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

/*
TEAM STRUCTURE USED FOR TESTING:

Organizations:
Connectomics department (Organization A), OrganizationB

Teams:
Connectomics department (Team AA), Team AB, Team BA, test1, test2
(the teams test1 and test2 existed before)

User:
default (UserAAA), User AAB, User AAC, User ABA, User BAA

++----------------------------------------------------------------------------------------------------------------------++--------------------------------------++
||	Connectomics department (Organization A)																			                                      ||	Organization B 						          ||
||  Admin: scmboy																										                                                    ||  Admin: userBAA					          	||
++-----------------------------------+--------------------------+---------------------------+---------------------------++--------------------------------------++
|| Connectomics department (Team AA) | 		Team AB				        | 		test1				          | 		test2				          ||  TeamBA 								              ||
++-----------------------------------+--------------------------+---------------------------+---------------------------++--------------------------------------++
|| scmboy (userAAA)	(teamMng)		     | 		userABA (teamMng.)    | 		scmboy            	  | 		scmboy (teamMng.)	    ||  userBAA	(teamMng.)			         		||
|| userAAB (teamMng.)		   		       | 						            	| 					              	| 						            	||  							                  		||
|| userAAC					   		           | 						            	| 					            		| 						            	||  							                  		||
++-----------------------------------+--------------------------+---------------------------+---------------------------++--------------------------------------++
 */

// Teams
test("teams_userDefault", async t => {
  await setCurrToken(tokenUserDefault);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "Connectomics department");
  t.is(teams[1].name, "team_AB");
  t.is(teams[2].name, "test1");
  t.is(teams[3].name, "test2");
  t.is(teams.length, 4);
});

test("teams_userABA", async t => {
  await setCurrToken(tokenUserABA);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_AB");
  t.is(teams.length, 1);
});

test("teams_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.is(teams[0].name, "team_BA");
  t.is(teams.length, 1);
});

test("teams_delete_userABA", async t => {
  // the teamManager is not allowed to delete the team
  await setCurrToken(tokenUserABA);
  try {
    await api.deleteTeam("69882b370d889b84020efd4f");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true); // not pretty, but "t.ok" seems to not exist
  }
});

test("teams_create_userABA", async t => {
  // the teamManager is not allowed to create a new team
  await setCurrToken(tokenUserABA);
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
  await setCurrToken(tokenUserDefault);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes[0].description, "Check those cells out!");
  t.is(taskTypes.length, 1);
});

test("taskTypes_userABA", async t => {
  await setCurrToken(tokenUserABA);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 0);
});

test("taskTypes_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType.id);
  t.is(taskTypes.length, 0);
});

// Tasks
test("tasks_userABA", async t => {
  await setCurrToken(tokenUserABA);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_userAAC", async t => {
  await setCurrToken(tokenUserAAC);
  try {
    // the test is NOT supposed to fail
    await api.getTask("58135c192faeb34c0081c058");
    t.true(true);
  } catch (err) {
    t.fail();
  }
});

// User
test("user_userAAB", async t => {
  // teamMng are not allowed to de-/activate a user (if they are not an admin)
  await setCurrToken(tokenUserAAB);
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
test("project_userAAB", async t => {
  // teamMng are not allowed to delete a project (if they are not an admin and they are not the owner)
  await setCurrToken(tokenUserBAA);
  try {
    const projectName = "Test_Project";
    await api.deleteProject(projectName);
    t.fail();
  } catch (err) {
    // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

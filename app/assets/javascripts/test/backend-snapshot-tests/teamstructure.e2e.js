/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserDefault, tokenUserAAB, tokenUserAAC, tokenUserABA, tokenUserBAA, setCurrToken } from "../enzyme/e2e-setup";
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
  t.snapshot(teams[0], { id: "teams_userDefault" });
});

test("teams_userABA", async t => {
  await setCurrToken(tokenUserABA);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams[0], { id: "teamsABA" });
});

test("teams_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams[0], { id: "teams_userBAA" });
});

test("teams_delete_userABA", async t => { // the teamManager is not allowed to delete the team
  await setCurrToken(tokenUserABA);
  try {
    await api.deleteTeam("69882b370d889b84020efd4f");
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true); // not pretty, but "t.ok" seems to not exist
  }
});

// TaskTypes
test("taskTypes_userDefault", async t => {
  await setCurrToken(tokenUserDefault);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypes_userDefault" });
});

test("taskTypes_userABA", async t => {
  await setCurrToken(tokenUserABA);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypes_userABA" });
});

test("taskTypes_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypes_userBAA" });
});

// Tasks
test("tasks_userABA", async t => {
  await setCurrToken(tokenUserABA);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_userBAA", async t => {
  await setCurrToken(tokenUserBAA);
  try {
    await api.getTask("58135c192faeb34c0081c058");
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

test("tasks_userAAC", async t => {
  await setCurrToken(tokenUserAAC);
  try { // the test is NOT supposed to fail
    await api.getTask("58135c192faeb34c0081c058");
    t.true(true);
  } catch (err) {
    t.fail();
  }
});

// these 2 o not work yet

// User
test("user_userAAB", async t => { // teamMng are not allowed to de-/activate a user (if they are not an admin)
  await setCurrToken(tokenUserAAB);
  try {
    const userIdABA = "870b9f4d2a7c0e4d008da6ef";
    const user = await api.getUser(userIdABA);
    const newUser = Object.assign({}, user, { isActive: false });
    const updatedUser = await api.updateUser(newUser);
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});



// Project
test("project_userAAB", async t => { // teamMng are not allowed to delete a project (if they are not an admin and they are not the owner)
  await setCurrToken(tokenUserBAA);
  try {
    const projectName = "Test_Project";
    const returnValue = api.deleteProject(projectName);
    t.is(returnValue, 1);
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true);
  }
});

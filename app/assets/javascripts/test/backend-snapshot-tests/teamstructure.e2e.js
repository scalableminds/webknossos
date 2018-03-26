/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserDefault, tokenUserAAB, tokenUserAAC, tokenUserABA, tokenUserBAA, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

let activeUser;

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
|| scmboy (userAAA)	(teamMng)		     | 		userABA (admin)		    | 		scmboy	(teamMng.)	  | 		scmboy (teamMng.)	    ||  userBAA	(teamMng.)			         		||
|| userAAB (teamMng.)		   		       | 						            	| 					              	| 						            	||  							                  		||
|| userAAC					   		           | 						            	| 					            		| 						            	||  							                  		||
++-----------------------------------+--------------------------+---------------------------+---------------------------++--------------------------------------++

 */
/*
test.before("Initialize values", async () => {
  setCurrToken(tokenUserDefault);
  activeUser = await api.getActiveUser();
});

test.serial("Test Name", async t => {
  t.is(activeUser.firstName, "SCM");
});
*/

// Teams
/*
test("team count", async t => {
  setCurrToken(defaultToken); // change this later
  const teams = await api.getTeams();
  t.is(teams.length, 3)
});
*/
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
test("tasks_userAAB", async t => {
  await setCurrToken(tokenUserAAB);
  try {
    const test = 3;//await api.getTask("TODO: taskID");
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true); // not pretty, but "t.ok" seems to not exist
  }
});


test("tasks_userAAC", async t => {
  await setCurrToken(tokenUserAAC);
  try { // the test is NOT supposed to fail
    const test = 3;//await api.getTask("TODO: taskID");
    t.true(true); // not pretty
  } catch (err) {
    t.fail(); // not pretty, but "t.ok" seems to not exist
  }
});

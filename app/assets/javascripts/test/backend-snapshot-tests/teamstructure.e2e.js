/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { userTokenA, userTokenB, userTokenC, userTokenD, userTokenE, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

let activeUser;

test.before("Initialize values", async () => {
  setCurrToken(userTokenA);
  activeUser = await api.getActiveUser();
});

// one of these should fail (just for testing)
test.serial("test whether the test is working", async t => {
  t.is(1, 1);
});

test.serial("test whether the test is working", async t => {
  t.is(1, 0);
});

test.serial("Test Name", async t => {
  t.is(activeUser.firstName, "SCM");
});

// Teams
/*
test("team count", async t => {
  setCurrToken(defaultToken); // change this later
  const teams = await api.getTeams();
  t.is(teams.length, 3)
});
*/
test("teamsA", async t => {
  setCurrToken(userTokenA); // change this later to userTokenA
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams[0], { id: "teamsA" }); // maybe take all teams and not only the first one. (does apply to a lot of tests)
});

test("teamsD", async t => {
  setCurrToken(userTokenA); // change this later to userTokenD
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams[0], { id: "teamsD" });
});

test("teamsE", async t => {
  setCurrToken(userTokenA); // change this later to userTokenE
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams[0], { id: "teamsE" });
});

// TaskTypes
test("taskTypesA", async t => {
  setCurrToken(userTokenA); // change this later to userTokenA
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypesA" });
});

test("taskTypesD", async t => {
  setCurrToken(userTokenA); // change this later to userTokenD
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypesD" });
});

test("taskTypesE", async t => {
  setCurrToken(userTokenA); // change this later to userTokenE
  const taskTypes = _.sortBy(await api.getTaskTypes(), taskType => taskType._id);
  t.snapshot(taskTypes, { id: "taskTypesE" });
});

// Tasks
test("tasksD", async t => {
 setCurrToken(userTokenA); // change this later to userTokenB
  try {
    const test = 3;//await api.getTask("TODO: taskID");
    t.fail();
  } catch (err) { // the test is supposed to fail => catch is the desired case
    t.true(true); // not pretty, but "t.ok" seems to not exist
  }
});


test("tasksE", async t => {
  setCurrToken(userTokenA); // change this later to userTokenC
  try { // the test is NOT supposed to fail
    const test = 3;//await api.getTask("TODO: taskID");
    t.true(true); // not pretty
  } catch (err) {
    t.fail(); // not pretty, but "t.ok" seems to not exist
  }
});

/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { userTokenA, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import moment from "moment";

let activeUser;
let firstTeam;

test.before("Initialize values", async () => {
  setCurrToken(userTokenA);
  activeUser = await api.getActiveUser();

  const teams = _.sortBy(await api.getTeams(), team => team.name);
  firstTeam = teams[0];
});

test("getTimeTrackingForUserByMonth", async t => {
  const timeTrackingForUserByMonth = await api.getTimeTrackingForUserByMonth(
    activeUser.email,
    moment("20180101", "YYYYMMDD"),
  );
  t.snapshot(timeTrackingForUserByMonth, { id: "timetracking-timeTrackingForUserByMonth" });
});

test("getTimeTrackingForUser", async t => {
  const timeTrackingForUser = await api.getTimeTrackingForUser(
    activeUser.id,
    moment("20180101", "YYYYMMDD"),
    moment("20180108", "YYYYMMDD"),
  );
  t.snapshot(timeTrackingForUser, { id: "timetracking-timeTrackingForUser" });
});

test("getProjectProgressReport", async t => {
  const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
  t.snapshot(projectProgressReport, { id: "timetracking-projectProgressReport" });
});

test("getOpenTasksReport", async t => {
  const openTasksReport = await api.getOpenTasksReport(firstTeam.id);
  t.snapshot(openTasksReport, { id: "timetracking-openTasksReport" });
});

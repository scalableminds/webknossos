/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import test from "ava";
import _ from "lodash";
import moment from "moment";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";

let activeUser;
let firstTeam;

test.before("Reset database and initialize values", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
  activeUser = await api.getActiveUser();

  const teams = _.sortBy(await api.getTeams(), team => team.name);
  firstTeam = teams[0];
});

test("getTimeTrackingForUserByMonth", async t => {
  const timeTrackingForUserByMonth = await api.getTimeTrackingForUserByMonth(
    activeUser.email,
    moment("20180801", "YYYYMMDD"),
  );
  writeFlowCheckingFile(timeTrackingForUserByMonth, "time-tracking", "APITimeTrackingType", {
    isArray: true,
  });
  t.snapshot(timeTrackingForUserByMonth, { id: "timetracking-timeTrackingForUserByMonth" });
});

test("getTimeTrackingForUser", async t => {
  const timeTrackingForUser = await api.getTimeTrackingForUser(
    activeUser.id,
    moment("20180101", "YYYYMMDD"),
    moment("20181001", "YYYYMMDD"),
  );
  t.snapshot(timeTrackingForUser, { id: "timetracking-timeTrackingForUser" });
});

test("getProjectProgressReport", async t => {
  const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
  writeFlowCheckingFile(projectProgressReport, "project-progress", "APIProjectProgressReportType", {
    isArray: true,
  });
  t.snapshot(projectProgressReport, { id: "timetracking-projectProgressReport" });
});

test("getOpenTasksReport", async t => {
  const openTasksReport = await api.getOpenTasksReport(firstTeam.id);
  writeFlowCheckingFile(openTasksReport, "open-tasks", "APIOpenTasksReportType", { isArray: true });
  t.snapshot(openTasksReport, { id: "timetracking-openTasksReport" });
});

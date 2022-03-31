// @flow
import _ from "lodash";
import moment from "moment";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'activeUser' implicitly has type 'any' in... Remove this comment to see the full error message
let activeUser;
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'firstTeam' implicitly has type 'any' in ... Remove this comment to see the full error message
let firstTeam;
test.before("Reset database and initialize values", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
  activeUser = await api.getActiveUser();

  const teams = _.sortBy(await api.getTeams(), (team) => team.name);

  firstTeam = teams[0];
});
test("getTimeTrackingForUserByMonth", async (t) => {
  const timeTrackingForUserByMonth = await api.getTimeTrackingForUserByMonth(
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'activeUser' implicitly has an 'any' type... Remove this comment to see the full error message
    activeUser.email,
    moment("20160401", "YYYYMMDD"),
  );
  t.true(timeTrackingForUserByMonth.length > 0);
  writeFlowCheckingFile(timeTrackingForUserByMonth, "time-tracking", "APITimeTracking", {
    isArray: true,
  });
  t.snapshot(timeTrackingForUserByMonth, {
    id: "timetracking-timeTrackingForUserByMonth",
  });
});
test("getTimeTrackingForUser", async (t) => {
  const timeTrackingForUser = await api.getTimeTrackingForUser(
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'activeUser' implicitly has an 'any' type... Remove this comment to see the full error message
    activeUser.id,
    moment("20180101", "YYYYMMDD"),
    moment("20181001", "YYYYMMDD"),
  );
  t.true(timeTrackingForUser.length > 0);
  t.snapshot(timeTrackingForUser, {
    id: "timetracking-timeTrackingForUser",
  });
});
test("getTimeTrackingForUser for a user other than the active user", async (t) => {
  const idUserC = "770b9f4d2a7c0e4d008da6ef";
  const timeTrackingForUser = await api.getTimeTrackingForUser(
    idUserC,
    moment("20160401", "YYYYMMDD"),
    moment("20160420", "YYYYMMDD"),
  );
  t.true(timeTrackingForUser.length > 0);
  t.snapshot(timeTrackingForUser, {
    id: "timetracking-timeTrackingForUser-C",
  });
});
test("getProjectProgressReport", async (t) => {
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'firstTeam' implicitly has an 'any' type.
  const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
  writeFlowCheckingFile(projectProgressReport, "project-progress", "APIProjectProgressReport", {
    isArray: true,
  });
  t.snapshot(projectProgressReport, {
    id: "timetracking-projectProgressReport",
  });
});
test("getOpenTasksReport", async (t) => {
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'firstTeam' implicitly has an 'any' type.
  const openTasksReport = await api.getOpenTasksReport(firstTeam.id);
  writeFlowCheckingFile(openTasksReport, "open-tasks", "APIOpenTasksReport", {
    isArray: true,
  });
  t.snapshot(openTasksReport, {
    id: "timetracking-openTasksReport",
  });
});

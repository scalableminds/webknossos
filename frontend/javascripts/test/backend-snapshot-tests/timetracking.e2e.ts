import _ from "lodash";
import dayjs from "dayjs";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
import { APITeam, APIUser } from "types/api_flow_types";

let activeUser: APIUser;
let firstTeam: APITeam;

test.before("Reset database and initialize values", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
  activeUser = await api.getActiveUser();

  const teams = _.sortBy(await api.getTeams(), (team) => team.name);

  firstTeam = teams[0];
});

test("getTimeTrackingForUserByMonth", async (t) => {
  const timeTrackingForUserByMonth = await api.getTimeTrackingForUserByMonth(
    activeUser.email,
    dayjs("20160401", "YYYYMMDD"),
  );
  t.true(timeTrackingForUserByMonth.length > 0);
  writeTypeCheckingFile(timeTrackingForUserByMonth, "time-tracking", "APITimeTracking", {
    isArray: true,
  });
  t.snapshot(timeTrackingForUserByMonth, {
    id: "timetracking-timeTrackingForUserByMonth",
  });
});

test("getTimeTrackingForUser", async (t) => {
  const timeTrackingForUser = await api.getTimeTrackingForUser(
    activeUser.id,
    dayjs("20180101", "YYYYMMDD"),
    dayjs("20181001", "YYYYMMDD"),
    "Task",
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
    dayjs("20160401", "YYYYMMDD"),
    dayjs("20160420", "YYYYMMDD"),
    "Task",
  );
  t.true(timeTrackingForUser.length > 0);
  t.snapshot(timeTrackingForUser, {
    id: "timetracking-timeTrackingForUser-C",
  });
});

test("getProjectProgressReport", async (t) => {
  const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
  writeTypeCheckingFile(projectProgressReport, "project-progress", "APIProjectProgressReport", {
    isArray: true,
  });
  t.snapshot(projectProgressReport, {
    id: "timetracking-projectProgressReport",
  });
});

test("getAvailableTasksReport", async (t) => {
  const availableTasksReport = await api.getAvailableTasksReport(firstTeam.id);
  writeTypeCheckingFile(availableTasksReport, "available-tasks", "APIAvailableTasksReport", {
    isArray: true,
  });
  t.snapshot(availableTasksReport, {
    id: "timetracking-availableTasksReport",
  });
});

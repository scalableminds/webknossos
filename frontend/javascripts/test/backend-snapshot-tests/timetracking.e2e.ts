import _ from "lodash";
import dayjs from "dayjs";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeTypeCheckingFile,
  replaceVolatileValues,
} from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
import type { APITeam, APIUser } from "types/api_flow_types";
import { AnnotationStateFilterEnum } from "oxalis/constants";

let activeUser: APIUser;
let firstTeam: APITeam;

test.before("Reset database and initialize values", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
  activeUser = await api.getActiveUser();

  const teams = _.sortBy(await api.getTeams(), (team) => team.name);

  firstTeam = teams[0];
});

// Note: /api/users/:userId/loggedTime is tested in users.e2e.ts

test("getTimeTrackingForUserSpans", async (t) => {
  const timeTrackingForUser = await api.getTimeTrackingForUserSpans(
    activeUser.id,
    dayjs("20180101", "YYYYMMDD").valueOf(),
    dayjs("20181001", "YYYYMMDD").valueOf(),
    "Task",
    AnnotationStateFilterEnum.ALL,
  );
  t.true(timeTrackingForUser.length > 0);
  t.snapshot(replaceVolatileValues(timeTrackingForUser));
});

test("getTimeTrackingForUser for a user other than the active user", async (t) => {
  const idUserC = "770b9f4d2a7c0e4d008da6ef";
  const timeTrackingForUser = await api.getTimeTrackingForUserSpans(
    idUserC,
    dayjs("20160401", "YYYYMMDD").valueOf(),
    dayjs("20160420", "YYYYMMDD").valueOf(),
    "Task",
    AnnotationStateFilterEnum.ALL,
  );
  t.true(timeTrackingForUser.length > 0);
  t.snapshot(replaceVolatileValues(timeTrackingForUser));
});

test("getProjectProgressReport", async (t) => {
  const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
  writeTypeCheckingFile(projectProgressReport, "project-progress", "APIProjectProgressReport", {
    isArray: true,
  });
  t.snapshot(projectProgressReport);
});

test("getAvailableTasksReport", async (t) => {
  const availableTasksReport = await api.getAvailableTasksReport(firstTeam.id);
  writeTypeCheckingFile(availableTasksReport, "available-tasks", "APIAvailableTasksReport", {
    isArray: true,
  });
  t.snapshot(availableTasksReport);
});

import _ from "lodash";
import dayjs from "dayjs";
import {
  tokenUserA,
  setUserAuthToken,
  resetDatabase,
  writeTypeCheckingFile,
  replaceVolatileValues,
} from "test/e2e-setup";
import * as api from "admin/rest_api";
import { describe, test, beforeAll, expect } from "vitest";
import type { APITeam, APIUser } from "types/api_types";
import { AnnotationStateFilterEnum } from "viewer/constants";

let activeUser: APIUser;
let firstTeam: APITeam;

describe("Time Tracking API (E2E)", () => {
  // Note: /api/users/:userId/loggedTime is tested in users.e2e.ts

  beforeAll(async () => {
    // Reset database and initialize values
    resetDatabase();
    setUserAuthToken(tokenUserA);
    activeUser = await api.getActiveUser();

    const teams = _.sortBy(await api.getTeams(), (team) => team.name);

    firstTeam = teams[0];
  });

  test("getTimeTrackingForUserSpans", async () => {
    const timeTrackingForUser = await api.getTimeTrackingForUserSpans(
      activeUser.id,
      dayjs("20180101", "YYYYMMDD").valueOf(),
      dayjs("20181001", "YYYYMMDD").valueOf(),
      "Task",
      AnnotationStateFilterEnum.ALL,
    );
    expect(timeTrackingForUser.length).toBeGreaterThan(0);
    expect(replaceVolatileValues(timeTrackingForUser)).toMatchSnapshot();
  });

  test("getTimeTrackingForUser for a user other than the active user", async () => {
    const idUserC = "770b9f4d2a7c0e4d008da6ef";
    const timeTrackingForUser = await api.getTimeTrackingForUserSpans(
      idUserC,
      dayjs("20160401", "YYYYMMDD").valueOf(),
      dayjs("20160420", "YYYYMMDD").valueOf(),
      "Task",
      AnnotationStateFilterEnum.ALL,
    );
    expect(timeTrackingForUser.length).toBeGreaterThan(0);
    expect(replaceVolatileValues(timeTrackingForUser)).toMatchSnapshot();
  });

  test("getProjectProgressReport", async () => {
    const projectProgressReport = await api.getProjectProgressReport(firstTeam.id);
    writeTypeCheckingFile(projectProgressReport, "project-progress", "APIProjectProgressReport", {
      isArray: true,
    });
    expect(projectProgressReport).toMatchSnapshot();
  });

  test("getAvailableTasksReport", async () => {
    const availableTasksReport = await api.getAvailableTasksReport(firstTeam.id);
    writeTypeCheckingFile(availableTasksReport, "available-tasks", "APIAvailableTasksReport", {
      isArray: true,
    });
    expect(availableTasksReport).toMatchSnapshot();
  });
});

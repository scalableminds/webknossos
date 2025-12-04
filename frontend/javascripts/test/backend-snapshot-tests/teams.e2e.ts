import _ from "lodash";
import { tokenUserA, setUserAuthToken, resetDatabase, writeTypeCheckingFile } from "test/e2e-setup";
import * as api from "admin/rest_api";
import { describe, beforeAll, expect, it } from "vitest";

describe("Teams API (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("getTeams()", async () => {
    const teams = _.sortBy(await api.getTeams(), (team) => team.name);

    writeTypeCheckingFile(teams, "team", "APITeam", {
      isArray: true,
    });

    expect(teams).toMatchSnapshot();
  });

  it("getEditableTeams()", async () => {
    const editableTeams = _.sortBy(await api.getEditableTeams(), (team) => team.name);

    expect(editableTeams).toMatchSnapshot();
  });

  it("createTeam and deleteTeam", async () => {
    const newTeam = {
      name: "test-team-name",
    };
    const createdTeam = await api.createTeam(newTeam);

    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdTeamWithFixedId = Object.assign({}, createdTeam, {
      id: "fixed-team-id",
    });
    expect(createdTeamWithFixedId).toMatchSnapshot();

    const response = await api.deleteTeam(createdTeam.id);
    expect(response).toMatchSnapshot();
  });
});

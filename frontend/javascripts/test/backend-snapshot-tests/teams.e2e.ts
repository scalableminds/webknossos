// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import { resetDatabase, setUserAuthToken, tokenUserA, writeTypeCheckingFile } from "test/e2e-setup";
import { createTeam, deleteTeam, getEditableTeams, getTeams } from "admin/rest_api";
import sortBy from "lodash-es/sortBy";
import { beforeAll, describe, expect, it } from "vitest";

describe("Teams API (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("getTeams()", async () => {
    const teams = sortBy(await getTeams(), (team) => team.name);

    writeTypeCheckingFile(teams, "team", "APITeam", {
      isArray: true,
    });

    expect(teams).toMatchSnapshot();
  });

  it("getEditableTeams()", async () => {
    const editableTeams = sortBy(await getEditableTeams(), (team) => team.name);

    expect(editableTeams).toMatchSnapshot();
  });

  it("createTeam and deleteTeam", async () => {
    const newTeam = {
      name: "test-team-name",
    };
    const createdTeam = await createTeam(newTeam);

    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdTeamWithFixedId = Object.assign({}, createdTeam, {
      id: "fixed-team-id",
    });
    expect(createdTeamWithFixedId).toMatchSnapshot();

    const response = await deleteTeam(createdTeam.id);
    expect(response).toMatchSnapshot();
  });
});

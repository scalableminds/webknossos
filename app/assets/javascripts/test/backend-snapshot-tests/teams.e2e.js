/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import _ from "lodash";

import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("getTeams()", async t => {
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  writeFlowCheckingFile(teams, "team", "APITeam", { isArray: true });
  t.snapshot(teams, { id: "teams-getTeams()" });
});

test("getEditableTeams()", async t => {
  const editableTeams = _.sortBy(await api.getEditableTeams(), team => team.name);
  t.snapshot(editableTeams, { id: "teams-getEditableTeams()" });
});

test("getOrganizationNames()", async t => {
  const organizations = await api.getOrganizationNames();
  t.snapshot(organizations, { id: "teams-getOrganizationNames()" });
});

test("createTeam and deleteTeam", async t => {
  const newTeam = {
    name: "test-team-name",
  };

  const createdTeam = await api.createTeam(newTeam);
  // Since the id will change after re-runs, we fix it here for easy
  // snapshotting
  const createdTeamWithFixedId = Object.assign({}, createdTeam, { id: "fixed-team-id" });
  t.snapshot(createdTeamWithFixedId, { id: "teams-createTeam(newTeam: NewTeamType)" });

  const response = await api.deleteTeam(createdTeam.id);
  t.snapshot(response, { id: "teams-deleteTeam(teamId: string)" });
});

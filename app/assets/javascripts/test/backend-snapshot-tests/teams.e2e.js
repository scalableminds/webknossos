/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserDefault, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

test.before("Change token", async () => {
  setCurrToken(tokenUserDefault);
});

test("getTeams()", async t => {
  const teams = _.sortBy(await api.getTeams(), team => team.name);
  t.snapshot(teams, { id: "teams-getTeams()" });
});

test("getEditableTeams()", async t => {
  const editableTeams = _.sortBy(await api.getEditableTeams(), team => team.name);
  t.snapshot(editableTeams, { id: "teams-getEditableTeams()" });
});

test("getOrganizations()", async t => {
  const organizations = await api.getOrganizations();
  t.snapshot(organizations, { id: "teams-getOrganizations()" });
});

test("createTeam and deleteTeam", async t => {
  const organizations = await api.getOrganizations();
  const newTeam = {
    name: "test-team-name",
    parent: organizations[0].name,
    roles: [{ name: "admin" }, { name: "user" }],
  };

  const createdTeam = await api.createTeam(newTeam);
  // Since the id will change after re-runs, we fix it here for easy
  // snapshotting
  const createdTeamWithFixedId = Object.assign({}, createdTeam, { id: "fixed-team-id" });
  t.snapshot(createdTeamWithFixedId, { id: "teams-createTeam(newTeam: NewTeamType)" });

  const response = await api.deleteTeam(createdTeam.id);
  t.snapshot(response, { id: "teams-deleteTeam(teamId: string)" });
});

/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

test("getTeams()", async t => {
  const teams = _.sortBy(await api.getTeams(), t => t.name);
  t.snapshot(teams, { id: "teams-getTeams()" });
});

test("getEditableTeams()", async t => {
  const editableTeams = _.sortBy(await api.getEditableTeams(), t => t.name);
  t.snapshot(editableTeams, { id: "teams-getEditableTeams()" });
});

test("getRootTeams()", async t => {
  const rootTeams = await api.getRootTeams();
  t.snapshot(rootTeams, { id: "teams-getRootTeams()" });
});

test("getAdminTeams()", async t => {
  const adminTeams = _.sortBy(await api.getAdminTeams(), t => t.name);
  t.snapshot(adminTeams, { id: "teams-getAdminTeams()" });
});

test("createTeam and deleteTeam", async t => {
  const rootTeams = await api.getRootTeams();
  const newTeam = {
    name: "test-team-name",
    parent: rootTeams[0].name,
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

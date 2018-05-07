/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserA, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import type { APIDatasetType } from "admin/api_flow_types";

async function getFirstDataset(): Promise<APIDatasetType> {
  const datasets = await api.getActiveDatasets();
  const dataset = _.sortBy(datasets, d => d.name)[0];

  return dataset;
}

test.before("Change token", async () => {
  setCurrToken(tokenUserA);
});

test.serial("getDatasets", async t => {
  let datasets = await api.getDatasets();

  let retry = 0;
  while (JSON.stringify(datasets).indexOf("Not imported yet") === -1 && retry < 10) {
    // eslint-disable-next-line no-await-in-loop
    datasets = await api.getDatasets();
    retry++;
  }
  datasets = _.sortBy(datasets, d => d.name);

  t.snapshot(datasets, { id: "datasets-getDatasets" });
});

test("getActiveDatasets", async t => {
  let datasets = await api.getActiveDatasets();
  datasets = _.sortBy(datasets, d => d.name);

  t.snapshot(datasets, { id: "datasets-getActiveDatasets" });
});

test("getDatasetAccessList", async t => {
  const dataset = await getFirstDataset();
  const accessList = api.getDatasetAccessList(dataset.name);

  t.snapshot(accessList, { id: "dataset-getDatasetAccessList" });
});

test("updateDatasetTeams", async t => {
  const dataset = await getFirstDataset();
  const newTeams = await api.getEditableTeams();

  const updatedDataset = api.updateDatasetTeams(dataset.name, newTeams.map(team => team.name));
  t.snapshot(updatedDataset, { id: "dataset-updateDatasetTeams" });

  // undo the Change
  api.updateDatasetTeams(dataset.name, dataset.allowedTeams.map(team => team.name));
});

test("getDatasetSharingToken and revokeDatasetSharingToken", async t => {
  const dataset = await getFirstDataset();

  const sharingToken = api.getDatasetSharingToken(dataset.name);
  t.snapshot(sharingToken, { id: "dataset-sharingToken" });

  await api.revokeDatasetSharingToken(dataset.name);
  t.pass();
});

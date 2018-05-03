/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserA, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

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
  const datasets = await api.getActiveDatasets();
  const dataset = _.sortBy(datasets, d => d.name)[0];
  const accessList = api.getDatasetAccessList(dataset.name);

  t.snapshot(accessList, { id: "dataset-getDatasetAccessList" });
});

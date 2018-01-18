/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

test.serial("Load datasets", async t => {
  let datasets = await api.getDatasets();

  let retry = 0;
  while (JSON.stringify(datasets).indexOf("Not imported yet") === -1 && retry < 10) {
    // eslint-disable-next-line no-await-in-loop
    datasets = await api.getDatasets();
    retry++;
  }
  datasets = _.sortBy(datasets, d => d.name);

  t.snapshot(datasets, { id: "datasets" });
});

test("Load active datasets", async t => {
  let datasets = await api.getActiveDatasets();
  datasets = _.sortBy(datasets, d => d.name);

  t.snapshot(datasets, { id: "active-datasets" });
});

test("Get Dataset Access List", async t => {
  const datasets = await api.getActiveDatasets();
  const dataset = _.sortBy(datasets, d => d.name)[0];
  const accessList = api.getDatasetAccessList(dataset.name);

  t.snapshot(accessList, { id: "dataset-accessList" });
});

// How should we test the following functions?
// addNDStoreDataset
// addDataset

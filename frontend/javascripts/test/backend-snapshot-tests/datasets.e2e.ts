import _ from "lodash";
import { tokenUserA, setCurrToken, resetDatabase, writeTypeCheckingFile } from "test/e2e-setup";
import type { APIDataset } from "types/api_flow_types";
import * as api from "admin/admin_rest_api";
import test from "ava";

async function getFirstDataset(): Promise<APIDataset> {
  const datasets = await api.getActiveDatasetsOfMyOrganization();

  const dataset = _.sortBy(datasets, (d) => d.name)[0];

  return dataset;
}

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test.serial("getDatasets", async (t) => {
  let datasets = await api.getDatasets();
  let retry = 0;

  while (JSON.stringify(datasets).indexOf("Not imported yet") === -1 && retry < 10) {
    datasets = await api.getDatasets();
    retry++;
  }

  datasets = _.sortBy(datasets, (d) => d.name);
  writeTypeCheckingFile(datasets, "dataset", "APIDatasetCompact", {
    isArray: true,
  });
  t.snapshot(datasets);
});
test("getActiveDatasets", async (t) => {
  let datasets = await api.getActiveDatasetsOfMyOrganization();
  datasets = _.sortBy(datasets, (d) => d.name);
  t.snapshot(datasets);
});
test("getDatasetAccessList", async (t) => {
  const dataset = await getFirstDataset();

  const accessList = _.sortBy(await api.getDatasetAccessList(dataset), (user) => user.id);

  t.snapshot(accessList);
});
test("updateDatasetTeams", async (t) => {
  const [dataset, newTeams] = await Promise.all([getFirstDataset(), api.getEditableTeams()]);
  const updatedDataset = await api.updateDatasetTeams(
    dataset,
    newTeams.map((team) => team.id),
  );
  t.snapshot(updatedDataset);
  // undo the Change
  await api.updateDatasetTeams(
    dataset,
    dataset.allowedTeams.map((team) => team.id),
  );
}); // test("getDatasetSharingToken and revokeDatasetSharingToken", async t => {
//   const dataset = await getFirstDataset();
//   const sharingToken = api.getDatasetSharingToken(dataset.name);
//   t.snapshot(sharingToken);
//   await api.revokeDatasetSharingToken(dataset.name);
//   t.pass();
// });

import _ from "lodash";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeTypeCheckingFile,
  replaceVolatileValues,
} from "test/e2e-setup";
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
  await api.triggerDatasetCheck("http://localhost:9000");
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
  t.snapshot(replaceVolatileValues(datasets));
});
test("getActiveDatasets", async (t) => {
  let datasets = await api.getActiveDatasetsOfMyOrganization();
  datasets = _.sortBy(datasets, (d) => d.name);
  t.snapshot(replaceVolatileValues(datasets));
});
test("getDatasetAccessList", async (t) => {
  const dataset = await getFirstDataset();

  const accessList = _.sortBy(await api.getDatasetAccessList(dataset), (user) => user.id);

  t.snapshot(replaceVolatileValues(accessList));
});
test("updateDatasetTeams", async (t) => {
  const [dataset, newTeams] = await Promise.all([getFirstDataset(), api.getEditableTeams()]);
  const updatedDataset = await api.updateDatasetTeams(
    dataset,
    newTeams.map((team) => team.id),
  );
  t.snapshot(replaceVolatileValues(updatedDataset));
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

test("Zarr streaming", async (t) => {
  const zattrsResp = await fetch("/data/zarr/Organization_X/test-dataset/segmentation/.zattrs", {
    headers: new Headers(),
  });
  const zattrs = await zattrsResp.text();
  t.snapshot(zattrs);

  const rawDataResponse = await fetch(
    "/data/zarr/Organization_X/test-dataset/segmentation/1/0.1.1.0",
    {
      headers: new Headers(),
    },
  );
  const bytes = await rawDataResponse.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  t.snapshot(base64);
});

test("Zarr 3 streaming", async (t) => {
  const zarrJsonResp = await fetch(
    "/data/zarr3_experimental/Organization_X/test-dataset/segmentation/zarr.json",
    {
      headers: new Headers(),
    },
  );
  const zarrJson = await zarrJsonResp.text();
  t.snapshot(zarrJson);

  const rawDataResponse = await fetch(
    "/data/zarr3_experimental/Organization_X/test-dataset/segmentation/1/0.1.1.0",
    {
      headers: new Headers(),
    },
  );
  const bytes = await rawDataResponse.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  t.snapshot(base64);
});

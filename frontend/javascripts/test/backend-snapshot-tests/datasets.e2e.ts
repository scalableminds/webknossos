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
import {
  getOrganizationForDataset,
  getDatasetIdFromNameAndOrganization,
} from "admin/api/disambiguate_legacy_routes";
import fs from "node:fs";

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
    dataset.id,
    newTeams.map((team) => team.id),
  );
  t.snapshot(replaceVolatileValues(updatedDataset));
  // undo the Change
  await api.updateDatasetTeams(
    dataset.id,
    dataset.allowedTeams.map((team) => team.id),
  );
});
test("It should correctly disambiguate old dataset links", async (t) => {
  let datasets = await api.getActiveDatasetsOfMyOrganization();
  for (const dataset of datasets) {
    const organizationId = await getOrganizationForDataset(dataset.name);
    t.is(organizationId, dataset.owningOrganization);
    const datasetId = await getDatasetIdFromNameAndOrganization(dataset.name, organizationId);
    t.is(datasetId, dataset.id);
  }
  t.pass();
});
// test("getDatasetSharingToken and revokeDatasetSharingToken", async t => {
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
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
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
  const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
  t.snapshot(base64);
});

test("Dataset upload", async (t) => {
  const uploadId = "test-dataset-upload-" + Date.now();

  const reserveUpload = await fetch("/data/datasets/reserveUpload", {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      filePaths: ["test-dataset-upload.zip"],
      folderId: "570b9f4e4bb848d0885ea917",
      initialTeams: [],
      layersToLink: [],
      name: "test-dataset-upload",
      organization: "Organization_X",
      totalFileCount: 1,
      uploadId: uploadId,
    }),
  });

  if (reserveUpload.status !== 200) {
    t.fail("Dataset reserve upload failed");
  }

  const filePath = "test/dataset/test-dataset.zip";
  const testDataset = fs.readFileSync(filePath);

  let formData = new FormData();
  formData.append("resumableChunkNumber", "1");
  formData.append("resumableChunkSize", "10485760");
  formData.append("resumableCurrentChunkSize", "71988");
  formData.append("resumableTotalSize", "71988");
  formData.append("resumableType", "application/zip");
  formData.append("resumableIdentifier", uploadId + "/test-dataset.zip");
  formData.append("resumableFilename", "test-dataset.zip");
  formData.append("resumableRelativePath", "test-dataset.zip");
  formData.append("resumableTotalChunks", "1");

  // Setting the correct content type header automatically does not work (the boundary is not included)
  // We can not extract the boundary from the FormData object
  // Thus we have to set the content type header ourselves and create the body manually

  const boundary = "----WebKitFormBoundaryAqTsFa4N9FW7zF7I";
  let bodyString = `--${boundary}\r\n`;
  // @ts-ignore
  for (const [key, value] of formData.entries()) {
    bodyString += `Content-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
    bodyString += `--${boundary}\r\n`;
  }
  bodyString += `Content-Disposition: form-data; name="file"; filename="test-dataset.zip"\r\n`;
  bodyString += "Content-Type: application/octet-stream\r\n\r\n";

  // We have to send the file as bytes, otherwise JS does some encoding, resulting in erroneous bytes

  const formBytes = new TextEncoder().encode(bodyString);
  const fileBytes = new Uint8Array(testDataset);
  const endBytes = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(formBytes.length + fileBytes.length + endBytes.length);
  body.set(formBytes, 0);
  body.set(fileBytes, formBytes.length);
  body.set(endBytes, formBytes.length + fileBytes.length);

  let content_type = `multipart/form-data; boundary=${boundary}`;

  const uploadResult = await fetch("/data/datasets", {
    method: "POST",
    headers: new Headers({
      "Content-Type": content_type,
    }),
    body: body,
  });

  if (uploadResult.status !== 200) {
    t.fail("Dataset upload failed");
  }

  const finishResult = await fetch("/data/datasets/finishUpload", {
    method: "POST",
    headers: new Headers({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      uploadId: uploadId,
      needsConversion: false,
    }),
  });

  if (finishResult.status !== 200) {
    t.fail("Dataset upload failed at finish");
  }

  const { newDatasetId } = await finishResult.json();
  const result = await fetch(`/api/datasets/${newDatasetId}/health`, {
    headers: new Headers(),
  });
  if (result.status !== 200) {
    t.fail("Dataset health check after upload failed");
  }
  t.pass();
});

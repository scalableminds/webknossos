import _ from "lodash";
import {
  tokenUserA,
  setUserAuthToken,
  resetDatabase,
  writeTypeCheckingFile,
  replaceVolatileValues,
} from "test/e2e-setup";
import type { APIDataset } from "types/api_types";
import * as api from "admin/rest_api";
import { describe, it, beforeAll, expect } from "vitest";
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

describe("Dataset API (E2E)", () => {
  beforeAll(async () => {
    // Reset database and change token
    resetDatabase();
    setUserAuthToken(tokenUserA);
    await api.triggerDatasetCheck("http://localhost:9000");
  });

  it("getDatasets", async () => {
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

    expect(replaceVolatileValues(datasets)).toMatchSnapshot();
  });

  it("getActiveDatasets", async () => {
    let datasets = await api.getActiveDatasetsOfMyOrganization();
    datasets = _.sortBy(datasets, (d) => d.name);

    expect(replaceVolatileValues(datasets)).toMatchSnapshot();
  });

  it("getDatasetAccessList", async () => {
    const dataset = await getFirstDataset();
    const accessList = _.sortBy(await api.getDatasetAccessList(dataset), (user) => user.id);

    expect(replaceVolatileValues(accessList)).toMatchSnapshot();
  });

  it("updateDatasetTeams", async () => {
    const [dataset, newTeams] = await Promise.all([getFirstDataset(), api.getEditableTeams()]);
    const updatedDataset = await api.updateDatasetTeams(
      dataset.id,
      newTeams.map((team) => team.id),
    );
    expect(replaceVolatileValues(updatedDataset)).toMatchSnapshot();

    // undo the Change
    await api.updateDatasetTeams(
      dataset.id,
      dataset.allowedTeams.map((team) => team.id),
    );
  });

  it("It should correctly disambiguate old dataset links", async () => {
    let datasets = await api.getActiveDatasetsOfMyOrganization();

    for (const dataset of datasets) {
      const organizationId = await getOrganizationForDataset(dataset.name);
      expect(organizationId).toBe(dataset.owningOrganization);

      const datasetId = await getDatasetIdFromNameAndOrganization(dataset.name, organizationId);
      expect(datasetId).toBe(dataset.id);
    }
  });

  // it("getDatasetSharingToken and revokeDatasetSharingToken", async () => {
  //   const dataset = await getFirstDataset();
  //   const sharingToken = api.getDatasetSharingToken(dataset.name);
  //   expect(sharingToken).toMatchSnapshot();
  //   await api.revokeDatasetSharingToken(dataset.name);
  //   expect(true).toBe(true);
  // });

  it("Zarr streaming", async () => {
    const zarrAttributesResponse = await fetch(
      "/data/zarr/Organization_X/test-dataset/segmentation/.zattrs",
      {
        headers: new Headers(),
      },
    );
    const zarrAttributes = await zarrAttributesResponse.text();
    expect(zarrAttributes).toMatchSnapshot();

    const rawDataResponse = await fetch(
      "/data/zarr/Organization_X/test-dataset/segmentation/1/0.1.1.0",
      {
        headers: new Headers(),
      },
    );
    const bytes = await rawDataResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
    expect(base64).toMatchSnapshot();
  });

  it("Zarr 3 streaming", async () => {
    const zarrJsonResp = await fetch(
      "/data/zarr3_experimental/Organization_X/test-dataset/segmentation/zarr.json",
      {
        headers: new Headers(),
      },
    );
    const zarrJson = await zarrJsonResp.text();
    expect(zarrJson).toMatchSnapshot();

    const rawDataResponse = await fetch(
      "/data/zarr3_experimental/Organization_X/test-dataset/segmentation/1/0.1.1.0",
      {
        headers: new Headers(),
      },
    );
    const bytes = await rawDataResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
    expect(base64).toMatchSnapshot();
  });

  it("Dataset Paths", async () => {
    const paths = await fetch(
      "/api/datastores/localhost/datasources/Organization_X/test-dataset/paths?key=something-secure",
    );
    const pathsJson = await paths.json();
    expect(replaceVolatileValues(pathsJson)).toMatchSnapshot();
  });

  /**
   * WARNING: This test creates a side effect by uploading and saving a dataset in your binaryData folder.
   * There is no clean up after the test, and the dataset will remain after each test run.
   */
  it("Dataset upload", async () => {
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
      expect.fail("Dataset reserve upload failed");
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
      expect.fail("Dataset upload failed");
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
      expect.fail("Dataset upload failed at finish");
    }

    const { newDatasetId } = await finishResult.json();
    const result = await fetch(`/api/datasets/${newDatasetId}/health`, {
      headers: new Headers(),
    });

    if (result.status !== 200) {
      expect.fail("Dataset health check after upload failed");
    }
  });
});

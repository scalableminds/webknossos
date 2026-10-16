// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import {
  replaceVolatileValues,
  resetDatabase,
  setUserAuthToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/e2e_setup";
import fs from "node:fs";
import { configure, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import {
  getDatasetIdFromNameAndOrganization,
  getOrganizationForDataset,
} from "admin/api/disambiguate_legacy_routes";
import {
  detectDatasetFormat,
  inferDatasetName,
  isArchive,
} from "admin/dataset/upload/detect_dataset_format";
import {
  cancelDatasetUpload,
  createResumableUpload,
  finishDatasetUpload,
  getActiveDatasetsOfMyOrganization,
  getDataset,
  getImportedDataset,
  getDatasetAccessList,
  getDatasets,
  getDatastores,
  getEditableTeams,
  getUnfinishedUploads,
  refreshToken,
  reserveDatasetUpload,
  triggerDatasetCheck,
  updateDatasetTeams,
} from "admin/rest_api";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import sortBy from "lodash-es/sortBy";
import type { FileWithPath } from "react-dropzone";
import { type APIDataset, APIJobCommand } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DATASTORE_URL = "http://localhost:9000";
const ORGANIZATION_ID = "Organization_X";
const ROOT_FOLDER_ID = "570b9f4e4bb848d0885ea917";

// Files picked via the dropzone or "Choose folder" carry their path in the dropped folder.
function createFile(path: string, content: Uint8Array | string): FileWithPath {
  const name = path.split("/").pop() ?? path;
  return Object.assign(new File([content as BlobPart], name), { path });
}

function getPaths(files: FileWithPath[]): string[] {
  return files.map((file) => file.path ?? file.name);
}

async function extractZipAsFolder(zipPath: string): Promise<FileWithPath[]> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(fs.readFileSync(zipPath))));
  const entries = await reader.getEntries();
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.directory)
      .map(async (entry) =>
        createFile(`/${entry.filename}`, await entry.getData!(new Uint8ArrayWriter())),
      ),
  );
  await reader.close();
  return files;
}

// A minimal single-scale OME-Zarr (v0.4) with an uncompressed uint8 array.
function createOmeZarrFolder(folderName: string, voxelSize: Vector3): FileWithPath[] {
  const shape = [16, 16, 16];
  const [x, y, z] = voxelSize;
  const zattrs = {
    multiscales: [
      {
        version: "0.4",
        axes: ["z", "y", "x"].map((name) => ({ name, type: "space", unit: "nanometer" })),
        datasets: [{ path: "0", coordinateTransformations: [{ type: "scale", scale: [z, y, x] }] }],
      },
    ],
  };
  const zarray = { zarr_format: 2, shape, chunks: shape, dtype: "|u1", order: "C", fill_value: 0 };
  const chunk = new Uint8Array(shape[0] * shape[1] * shape[2]).map((_, index) => index % 256);
  return [
    createFile(`/${folderName}/.zgroup`, JSON.stringify({ zarr_format: 2 })),
    createFile(`/${folderName}/.zattrs`, JSON.stringify(zattrs)),
    createFile(`/${folderName}/0/.zarray`, JSON.stringify(zarray)),
    createFile(`/${folderName}/0/0.0.0`, chunk),
  ];
}

// A minimal baseline TIFF: 8-bit grayscale, uncompressed, a single strip.
function createTiff(width: number, height: number, fillValue: number): Uint8Array {
  const entries: Array<[tag: number, type: "short" | "long", value: number]> = [
    [256, "short", width], // ImageWidth
    [257, "short", height], // ImageLength
    [258, "short", 8], // BitsPerSample
    [259, "short", 1], // Compression: none
    [262, "short", 1], // PhotometricInterpretation: BlackIsZero
    [273, "long", 0], // StripOffsets, filled in below
    [277, "short", 1], // SamplesPerPixel
    [278, "short", height], // RowsPerStrip
    [279, "long", width * height], // StripByteCounts
  ];
  const ifdOffset = 8;
  const pixelOffset = ifdOffset + 2 + entries.length * 12 + 4;
  const bytes = new Uint8Array(pixelOffset + width * height);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]); // "II": little endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach(([tag, type, value], index) => {
    const entryOffset = ifdOffset + 2 + index * 12;
    view.setUint16(entryOffset, tag, true);
    view.setUint16(entryOffset + 2, type === "short" ? 3 : 4, true);
    view.setUint32(entryOffset + 4, 1, true); // count
    const entryValue = tag === 273 ? pixelOffset : value;
    if (type === "short") view.setUint16(entryOffset + 8, entryValue, true);
    else view.setUint32(entryOffset + 8, entryValue, true);
  });
  bytes.fill(fillValue, pixelOffset);
  return bytes;
}

type ConversionSettings = { voxelSizeFactor: Vector3; voxelSizeUnit: UnitLong };

const TIFF_CONVERSION: ConversionSettings = {
  voxelSizeFactor: [5, 5, 40],
  voxelSizeUnit: UnitLong.nm,
};

// Reserves an upload like useResumableDatasetUpload.startUpload does and returns its id.
async function reserveUpload(
  datasetName: string,
  files: FileWithPath[],
  conversion?: ConversionSettings,
): Promise<string> {
  const uploadId = `e2e__${crypto.randomUUID()}`;
  await refreshToken();
  await reserveDatasetUpload(DATASTORE_URL, {
    resumableUploadInfo: {
      uploadId,
      totalFileCount: files.length,
      filePaths: getPaths(files),
      totalFileSizeInBytes: files.reduce((sum, file) => sum + file.size, 0),
    },
    datasetName,
    organizationId: ORGANIZATION_ID,
    layersToLink: [],
    initialTeamIds: [],
    folderId: ROOT_FOLDER_ID,
    needsConversion: conversion != null,
    voxelSizeFactor: conversion?.voxelSizeFactor,
    voxelSizeUnit: conversion?.voxelSizeUnit,
  });
  return uploadId;
}

// Sends all files of a reserved upload. Resolves once every chunk was accepted.
async function sendFiles(uploadId: string, files: FileWithPath[]): Promise<void> {
  const resumableUpload = await createResumableUpload(DATASTORE_URL, uploadId);
  await new Promise<void>((resolve, reject) => {
    resumableUpload.addEventListener("complete", (event: ResumableUploadEvent) => {
      if (event.detail.type === "complete" && event.detail.didUploadCompleteSuccessfully) {
        resolve();
      } else {
        reject(new Error(`Upload ${uploadId} did not complete successfully.`));
      }
    });
    resumableUpload.addEventListener("terminalFileError", (event: ResumableUploadEvent) => {
      reject(new Error(`Upload ${uploadId} failed: ${JSON.stringify(event.detail)}`));
    });
    resumableUpload.addEventListener("filesAdded", () => resumableUpload.upload());
    resumableUpload.addFiles(files as File[]);
  });
}

async function uploadDatasetWithoutConversion(datasetName: string, files: FileWithPath[]) {
  const uploadId = await reserveUpload(datasetName, files);
  await sendFiles(uploadId, files);
  const { datasetId } = await finishDatasetUpload(DATASTORE_URL, uploadId);
  return datasetId;
}

async function findUnfinishedUpload(uploadId: string) {
  const unfinishedUploads = await getUnfinishedUploads(DATASTORE_URL, ORGANIZATION_ID);
  return unfinishedUploads.find((upload) => upload.uploadId === uploadId);
}

// Reserving an upload already creates the dataset, so it can be looked up before finishing.
async function findDatasetIdsByName(datasetName: string): Promise<string[]> {
  const datasets = await getDatasets(null, null, datasetName);
  return datasets.filter((dataset) => dataset.name === datasetName).map((dataset) => dataset.id);
}

// Failed requests reject with the server's error messages, including the error chain.
async function expectRequestToFailWith(request: Promise<unknown>, expectedMessage: string) {
  const error = await request.then(
    () => expect.fail(`Expected the request to fail with "${expectedMessage}".`),
    (requestError) => requestError,
  );
  expect(JSON.stringify(error)).toContain(expectedMessage);
}

async function getFirstDataset(): Promise<APIDataset> {
  const datasets = await getActiveDatasetsOfMyOrganization();
  const compactDataset = sortBy(datasets, (d) => d.name)[0];

  return getImportedDataset(compactDataset.id);
}

describe("Dataset API (E2E)", () => {
  beforeAll(async () => {
    // Reset database and change token
    resetDatabase();
    setUserAuthToken(tokenUserA);
    await triggerDatasetCheck("http://localhost:9000");
  });

  it("getDatasets", async () => {
    let datasets = await getDatasets();
    let retry = 0;

    while (JSON.stringify(datasets).indexOf("Not imported yet") === -1 && retry < 10) {
      datasets = await getDatasets();
      retry++;
    }

    datasets = sortBy(datasets, (d) => d.name);
    writeTypeCheckingFile(datasets, "dataset", "APIDatasetCompact", {
      isArray: true,
    });

    expect(replaceVolatileValues(datasets)).toMatchSnapshot();
  });

  it("getActiveDatasets", async () => {
    let datasets = await getActiveDatasetsOfMyOrganization();
    datasets = sortBy(datasets, (d) => d.name);

    expect(replaceVolatileValues(datasets)).toMatchSnapshot();
  });

  it("getDatasetAccessList", async () => {
    const dataset = await getFirstDataset();
    const accessList = sortBy(await getDatasetAccessList(dataset), (user) => user.id);

    expect(replaceVolatileValues(accessList)).toMatchSnapshot();
  });

  it("updateDatasetTeams", async () => {
    const [dataset, newTeams] = await Promise.all([getFirstDataset(), getEditableTeams()]);
    const updatedDataset = await updateDatasetTeams(
      dataset.id,
      newTeams.map((team) => team.id),
    );
    expect(replaceVolatileValues(updatedDataset)).toMatchSnapshot();

    // undo the Change
    await updateDatasetTeams(
      dataset.id,
      dataset.allowedTeams.map((team) => team.id),
    );
  });

  it("It should correctly disambiguate old dataset links", async () => {
    let datasets = await getActiveDatasetsOfMyOrganization();

    for (const dataset of datasets) {
      const organizationId = await getOrganizationForDataset(dataset.name);
      expect(organizationId).toBe(dataset.owningOrganization);

      const datasetId = await getDatasetIdFromNameAndOrganization(dataset.name, organizationId);
      expect(datasetId).toBe(dataset.id);
    }
  });

  // it("getDatasetSharingToken and revokeDatasetSharingToken", async () => {
  //   const dataset = await getFirstDataset();
  //   const sharingToken = getDatasetSharingToken(dataset.name);
  //   expect(sharingToken).toMatchSnapshot();
  //   await revokeDatasetSharingToken(dataset.name);
  //   expect(true).toBe(true);
  // });

  it("Public dataset access", async () => {
    const datasetCompactList = await getDatasets();
    // Get dataset details (which includes isPublic flag). With this call we also validate that the private dataset
    // we query can be accessed with the current user token (we later access it without a token and expect it to fail).
    const datasets = await Promise.all(datasetCompactList.map((dataset) => getDataset(dataset.id)));

    const publicDatasetId = datasets.find((d) => d.isPublic)?.id;
    const privateDatasetId = datasets.find((d) => !d.isPublic)?.id;
    if (!publicDatasetId || !privateDatasetId) {
      throw new Error("Did not find public or private dataset");
    }

    setUserAuthToken("invalidToken");
    const publicDataset = await getDataset(publicDatasetId);
    expect(publicDataset).toBeDefined();
    expect(publicDataset.isPublic).toBe(true);
    // Accessing private dataset without token should fail
    try {
      await getDataset(privateDatasetId);
      expect.fail("Accessing private dataset without token should fail");
    } catch (error) {
      expect(error).toBeDefined();
    }
    setUserAuthToken(tokenUserA);
  });

  async function getTestDatasetId(datasetName: string = "test-dataset"): Promise<string> {
    let datasets = await getActiveDatasetsOfMyOrganization();
    const dataset = datasets.find((d) => d.name === datasetName);
    if (!dataset) {
      throw new Error(`Dataset with name ${datasetName} not found`);
    }
    return dataset.id;
  }

  it("Zarr streaming", async () => {
    const datasetId = await getTestDatasetId();
    const zarrAttributesResponse = await fetch(`/data/zarr/${datasetId}/segmentation/.zattrs`, {
      headers: new Headers(),
    });
    const zarrAttributes = await zarrAttributesResponse.text();
    expect(zarrAttributes).toMatchSnapshot();

    const rawDataResponse = await fetch(`/data/zarr/${datasetId}/segmentation/1/0.1.1.0`, {
      headers: new Headers(),
    });
    expect(rawDataResponse.ok).toBe(true);
    const bytes = await rawDataResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
    expect(base64).toMatchSnapshot();
  });

  it("Zarr 3 streaming", async () => {
    const datasetId = await getTestDatasetId();
    const zarrJsonResp = await fetch(
      `/data/zarr3_experimental/${datasetId}/segmentation/zarr.json`,
      {
        headers: new Headers(),
      },
    );
    const zarrJson = await zarrJsonResp.text();
    expect(zarrJson).toMatchSnapshot();

    const rawDataResponse = await fetch(
      `/data/zarr3_experimental/${datasetId}/segmentation/1/0.1.1.0`,
      {
        headers: new Headers(),
      },
    );

    expect(rawDataResponse.ok).toBe(true);
    const bytes = await rawDataResponse.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes.slice(-128))));
    expect(base64).toMatchSnapshot();
  });

  /**
   * WARNING: This test creates a side effect by uploading and saving a dataset in your binaryData folder.
   * There is no clean up after the test, and the dataset will remain after each test run.
   */
  it("Dataset upload", async () => {
    const uploadId = "test-dataset-upload-" + Date.now();

    const reserveUpload = await fetch("/data/datasets/upload/dataset/reserveUpload", {
      method: "POST",
      headers: new Headers({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        resumableUploadInfo: {
          filePaths: ["test-dataset.zip"],
          totalFileCount: 1,
          uploadId: uploadId,
        },
        folderId: "570b9f4e4bb848d0885ea917",
        initialTeamIds: [],
        layersToLink: [],
        datasetName: "test-dataset-upload",
        organizationId: "Organization_X",
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

    const uploadResult = await fetch("/data/datasets/upload/dataset", {
      method: "POST",
      headers: new Headers({
        "Content-Type": content_type,
      }),
      body: body,
    });

    if (uploadResult.status !== 200) {
      expect.fail("Dataset upload failed");
    }

    const finishResult = await fetch(
      `/data/datasets/upload/dataset/finishUpload?uploadId=${uploadId}`,
      {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
        }),
      },
    );

    if (finishResult.status !== 200) {
      expect.fail("Dataset upload failed at finish");
    }

    const { datasetId } = await finishResult.json();
    const result = await fetch(`/api/datasets/${datasetId}/health`, {
      headers: new Headers(),
    });

    if (result.status !== 200) {
      expect.fail("Dataset health check after upload failed");
    }
  });

  /*
   * These tests upload datasets the way the upload view does: the selected files are run through
   * the format detection first, then sent with the same client code (reserve → resumable upload →
   * finish). This checks that what the UI promises from file names alone ("ready to view",
   * "will be converted") matches what the backend actually does with the files.
   *
   * They have to run last: deleting an uploaded dataset leaves its directory on disk, and the
   * dataset check in beforeAll would list it in the snapshots above. Also, the WKW upload is
   * named "test-dataset" like the dataset the streaming tests look up by name.
   */
  describe("Upload scenarios", () => {
    beforeAll(() => {
      // The resumable upload resolves its target URL against the page origin.
      vi.stubGlobal("window", { location: { origin: DATASTORE_URL } });
      // zip.js would spawn web workers by default, which don't exist in node.
      configure({ useWebWorkers: false });
    });

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    it("A WEBKNOSSOS dataset dropped as a folder is recognized and viewable right away", async () => {
      const files = await extractZipAsFolder("test/dataset/test-dataset.zip");
      const paths = getPaths(files);

      const format = detectDatasetFormat(paths);
      expect(format).toEqual({
        kind: "native",
        formatName: "WEBKNOSSOS dataset",
        layerNames: ["segmentation"],
      });
      const datasetName = inferDatasetName(paths);
      expect(datasetName).toBe("test-dataset");

      const datasetId = await uploadDatasetWithoutConversion(datasetName, files);
      const dataset = await getImportedDataset(datasetId);
      expect(dataset.isActive).toBe(true);
      expect(dataset.name).toBe(datasetName);
      expect(dataset.dataSource.dataLayers.map((layer) => layer.name)).toEqual(
        format.kind === "native" ? format.layerNames : [],
      );
    });

    it("An OME-Zarr folder is recognized and explored by the backend without conversion", async () => {
      const voxelSize: Vector3 = [11, 12, 13];
      const files = createOmeZarrFolder("sample.ome.zarr", voxelSize);
      const paths = getPaths(files);

      expect(detectDatasetFormat(paths)).toEqual({
        kind: "native",
        formatName: "OME-Zarr",
        layerNames: [],
      });
      const datasetName = inferDatasetName(paths);
      expect(datasetName).toBe("sample.ome.zarr");

      const datasetId = await uploadDatasetWithoutConversion(datasetName, files);
      const dataset = await getImportedDataset(datasetId);
      expect(dataset.isActive).toBe(true);
      expect(dataset.dataSource.dataLayers).toHaveLength(1);
      expect(dataset.dataSource.dataLayers[0].elementClass).toBe("uint8");
      expect(dataset.dataSource.scale.factor).toEqual(voxelSize);
    });

    it("A TIFF stack needs conversion and can be listed as unfinished and cancelled", async () => {
      const files = [1, 2, 3].map((index) =>
        createFile(`/slice_000${index}.tif`, createTiff(8, 8, index * 50)),
      );
      const paths = getPaths(files);

      expect(detectDatasetFormat(paths)).toEqual({
        kind: "imageStack",
        formatName: "TIFF",
        sliceCount: 3,
        layerCount: 1,
      });
      const datasetName = inferDatasetName(paths);
      expect(datasetName).toBe("slice");

      // The E2E setup has no workers, so the upload view shows "can't be uploaded" for this
      // selection. Finishing it would fail when the backend tries to start the conversion job.
      const [datastore] = await getDatastores();
      expect(datastore.jobsSupportedByAvailableWorkers).not.toContain(APIJobCommand.CONVERT_TO_WKW);

      const uploadId = await reserveUpload(datasetName, files, TIFF_CONVERSION);
      await sendFiles(uploadId, files);

      // "Continue upload" relies on this list and on the file paths to match the new selection.
      const unfinishedUpload = await findUnfinishedUpload(uploadId);
      expect(unfinishedUpload?.datasetName).toBe(datasetName);
      expect(unfinishedUpload?.filePaths?.slice().sort()).toEqual(paths.slice().sort());

      await cancelDatasetUpload(DATASTORE_URL, uploadId);
      expect(await findUnfinishedUpload(uploadId)).toBeUndefined();
    });

    it("A broken zip can't be read by the upload view, fails to finish and is cleaned up", async () => {
      // A download that was cut off: the central directory at the end of the archive is missing.
      const zipBytes = new Uint8Array(fs.readFileSync("test/dataset/test-dataset.zip"));
      const truncatedZip = zipBytes.slice(0, Math.floor(zipBytes.length / 2));
      const files = [createFile("/broken-archive.zip", truncatedZip)];

      // The upload view lists the entries with zip.js and shows "can't be uploaded" if that fails.
      expect(isArchive(files[0].name)).toBe(true);
      await expect(
        new ZipReader(new Uint8ArrayReader(truncatedZip)).getEntries(),
      ).rejects.toThrow();
      const datasetName = inferDatasetName(getPaths(files));
      expect(datasetName).toBe("broken-archive");

      const uploadId = await reserveUpload(datasetName, files);
      expect(await findDatasetIdsByName(datasetName)).toHaveLength(1);
      await sendFiles(uploadId, files);
      await expectRequestToFailWith(
        finishDatasetUpload(DATASTORE_URL, uploadId),
        "Error while unpacking dataset",
      );

      // The datastore asks WEBKNOSSOS to delete the dataset without waiting for it.
      await vi.waitFor(async () => expect(await findDatasetIdsByName(datasetName)).toEqual([]), {
        timeout: 5000,
        interval: 250,
      });
      expect(await findUnfinishedUpload(uploadId)).toBeUndefined();
    });

    it.each([
      { folderName: "Mouse cortex (2024)", inferredName: "Mouse_cortex_2024_" },
      { folderName: ".hidden-scan", inferredName: "hidden-scan" },
    ])(
      "The folder name '$folderName' is rejected, the inferred name '$inferredName' is accepted",
      async ({ folderName, inferredName }) => {
        const files = [1, 2].map((index) =>
          createFile(`/${folderName}/slice_000${index}.tif`, createTiff(8, 8, index * 50)),
        );
        const datasetName = inferDatasetName(getPaths(files));
        expect(datasetName).toBe(inferredName);

        await expectRequestToFailWith(
          reserveUpload(folderName, files, TIFF_CONVERSION),
          "Dataset name is invalid",
        );
        expect(await findDatasetIdsByName(folderName)).toEqual([]);

        const uploadId = await reserveUpload(datasetName, files, TIFF_CONVERSION);
        expect(await findDatasetIdsByName(datasetName)).toHaveLength(1);
        await cancelDatasetUpload(DATASTORE_URL, uploadId);
        expect(await findDatasetIdsByName(datasetName)).toEqual([]);
      },
    );
  });
});

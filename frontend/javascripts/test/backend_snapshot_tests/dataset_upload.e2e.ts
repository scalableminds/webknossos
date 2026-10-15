// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import { resetDatabase, setUserAuthToken, tokenUserA } from "test/e2e_setup";
import fs from "node:fs";
import { configure, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import {
  detectDatasetFormat,
  inferDatasetName,
  isArchive,
} from "admin/dataset/upload/detect_dataset_format";
import {
  cancelDatasetUpload,
  createResumableUpload,
  deleteDatasetOnDisk,
  finishDatasetUpload,
  getDatasets,
  getDatastores,
  getImportedDataset,
  getUnfinishedUploads,
  refreshToken,
  reserveDatasetUpload,
} from "admin/rest_api";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import type { FileWithPath } from "react-dropzone";
import { APIJobCommand } from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * These tests upload datasets the way the upload view does: the selected files are run through
 * the format detection first, then sent with the same client code (reserve → resumable upload →
 * finish). This checks that what the UI promises from file names alone ("ready to view",
 * "will be converted") matches what the backend actually does with the files.
 *
 * Every test cleans up after itself so that the uploaded datasets don't show up in the dataset
 * snapshots of other E2E tests.
 */

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

describe("Dataset upload (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
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
    try {
      const dataset = await getImportedDataset(datasetId);
      expect(dataset.isActive).toBe(true);
      expect(dataset.name).toBe(datasetName);
      expect(dataset.dataSource.dataLayers.map((layer) => layer.name)).toEqual(
        format.kind === "native" ? format.layerNames : [],
      );
    } finally {
      await deleteDatasetOnDisk(datasetId);
    }
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
    try {
      const dataset = await getImportedDataset(datasetId);
      expect(dataset.isActive).toBe(true);
      expect(dataset.dataSource.dataLayers).toHaveLength(1);
      expect(dataset.dataSource.dataLayers[0].elementClass).toBe("uint8");
      expect(dataset.dataSource.scale.factor).toEqual(voxelSize);
    } finally {
      await deleteDatasetOnDisk(datasetId);
    }
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
    await expect(new ZipReader(new Uint8ArrayReader(truncatedZip)).getEntries()).rejects.toThrow();
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

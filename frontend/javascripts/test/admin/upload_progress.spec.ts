import { getUploadProgress, groupFilesByLayer } from "admin/dataset/upload/upload_layers";
import {
  getStageStatuses,
  getStages,
  getUploadPhase,
} from "admin/dataset/upload/upload_progress_stages";
import type { UploadStatus } from "admin/dataset/upload/use_resumable_dataset_upload";
import type { FileWithPath } from "react-dropzone";
import type { APIJob } from "types/api_types";
import { describe, expect, it } from "vitest";

function createFile(path: string, size: number): FileWithPath {
  const file = new File([new Uint8Array(size)], path.split("/").pop() ?? path) as FileWithPath;
  Object.defineProperty(file, "path", { value: path });
  return file;
}

describe("groupFilesByLayer", () => {
  it("groups the files of a native dataset by their layer folder", () => {
    const files = [
      createFile("/ds/datasource-properties.json", 5),
      createFile("/ds/color/1/z0/y0/x0.wkw", 100),
      createFile("/ds/color/1/header.wkw", 10),
      createFile("/ds/segmentation/1/z0/y0/x0.wkw", 200),
      createFile("/ds/segmentation/1/header.wkw", 10),
    ];
    const { layers, layerIndexByFile } = groupFilesByLayer(files);
    expect(layers).toEqual([
      { name: "color", bytes: 110, sentBytes: 0 },
      { name: "segmentation", bytes: 210, sentBytes: 0 },
    ]);
    // The datasource-properties.json belongs to no layer.
    expect(layerIndexByFile.size).toBe(4);
  });

  it("puts uploads without layer folders into a single group", () => {
    const files = [createFile("/stack/slice_001.tif", 50), createFile("/stack/slice_002.tif", 50)];
    expect(groupFilesByLayer(files).layers).toEqual([{ name: "stack/", bytes: 100, sentBytes: 0 }]);
  });

  it("sums the progress of the files per layer and in total", () => {
    const files = [
      createFile("/ds/color/1/a.wkw", 100),
      createFile("/ds/color/1/b.wkw", 100),
      createFile("/ds/segmentation/1/a.wkw", 100),
    ];
    const groups = groupFilesByLayer(files);
    const progresses = [1, 0.5, 0].map((progress, index) => ({
      file: files[index] as File,
      size: files[index].size,
      progress: () => progress,
    }));
    const { bytesSent, layers } = getUploadProgress(groups, progresses);
    expect(layers.map((layer) => layer.sentBytes)).toEqual([150, 0]);
    expect(bytesSent).toBe(150);
  });
});

describe("upload stages", () => {
  const uploadInfo = {
    datasetName: "ds",
    formatName: "TIFF",
    bytesTotal: 100,
    layers: [],
  };
  const finished = (needsConversion: boolean): UploadStatus & { kind: "finished" } => ({
    kind: "finished",
    datasetId: "id",
    conversionJobId: needsConversion ? "jobId" : null,
    needsConversion,
    ...uploadInfo,
  });
  const job = (state: APIJob["state"]) => ({ state, errorDetails: null }) as unknown as APIJob;

  it("skips the conversion of native datasets", () => {
    const phase = getUploadPhase(finished(false), null);
    expect(phase).toEqual({ kind: "ready" });
    expect(getStages(false)).toEqual(["upload", "finalize", "ready"]);
    expect(getStages(true)).toEqual(["upload", "finalize", "convert", "ready"]);
  });

  it("follows the conversion job", () => {
    expect(getUploadPhase(finished(true), null)).toEqual({ kind: "converting" });
    expect(getUploadPhase(finished(true), job("STARTED"))).toEqual({ kind: "converting" });
    expect(getUploadPhase(finished(true), job("SUCCESS"))).toEqual({ kind: "ready" });
    const failedPhase = getUploadPhase(finished(true), job("FAILURE"));
    expect(failedPhase.kind).toBe("failed");
    expect(getStageStatuses(failedPhase)).toEqual({
      upload: "done",
      finalize: "done",
      convert: "error",
      ready: "todo",
    });
  });

  it("marks the current stage as active", () => {
    expect(getStageStatuses({ kind: "finalizing" })).toEqual({
      upload: "done",
      finalize: "active",
      convert: "todo",
      ready: "todo",
    });
  });
});

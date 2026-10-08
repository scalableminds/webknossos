import Request from "libs/request";
import type { APIJob, VoxelSize } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getJobs, type JobCreditCostInfo } from "./jobs";
import { doWithToken } from "./token";

export type SectionRange = { readonly first: number; readonly last: number };

// UPLOADING: upload not finished yet. INVALID: the tile CSV could not be parsed.
export type AlignmentProjectStatus = "UPLOADING" | "READY" | "INVALID";

export type APIAlignmentProject = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: AlignmentProjectStatus;
  readonly invalidReason: string | null | undefined;
  readonly created: number;
  readonly ownerFirstName: string;
  readonly ownerLastName: string;
  readonly dataStoreName: string;
  readonly voxelSize: VoxelSize;
  // Relative to the alignment project directory.
  readonly csvPath: string | null | undefined;
  // All uploaded files, including the CSV. Known once the upload is finished.
  readonly fileCount: number | null | undefined;
  readonly totalSizeInBytes: number | null | undefined;
  // Inclusive section numbers, extracted from the CSV. Only set if the project is READY.
  readonly sectionRange: SectionRange | null | undefined;
  // The uploaded files were deleted to free storage. Metadata and past jobs are kept.
  readonly isInputDataDeleted: boolean;
  readonly jobCount: number;
};

export function getAlignmentProjects(): Promise<APIAlignmentProject[]> {
  return Request.receiveJSON("/api/alignmentProjects");
}

export function getAlignmentProject(id: string): Promise<APIAlignmentProject> {
  return Request.receiveJSON(`/api/alignmentProjects/${id}`);
}

export function updateAlignmentProject(
  id: string,
  update: { name?: string; description?: string; voxelSize?: VoxelSize },
): Promise<APIAlignmentProject> {
  return Request.sendJSONReceiveJSON(`/api/alignmentProjects/${id}`, {
    method: "PATCH",
    data: update,
  });
}

export function deleteAlignmentProjectInputData(id: string): Promise<APIAlignmentProject> {
  return Request.receiveJSON(`/api/alignmentProjects/${id}/inputData`, { method: "DELETE" });
}

export function deleteAlignmentProject(id: string): Promise<void> {
  return Request.triggerRequest(`/api/alignmentProjects/${id}`, { method: "DELETE" });
}

export function getAlignmentProjectJobs(id: string): Promise<APIJob[]> {
  return getJobs(undefined, undefined, id);
}

export function getAlignmentProjectJobCreditCost(
  id: string,
  renderUnaligned: boolean,
  // null means all sections.
  sectionRange: SectionRange | null,
): Promise<JobCreditCostInfo> {
  const params = new URLSearchParams({ renderUnaligned: renderUnaligned ? "true" : "false" });
  if (sectionRange != null) {
    params.set("firstSection", String(sectionRange.first));
    params.set("lastSection", String(sectionRange.last));
  }
  return Request.receiveJSON(`/api/alignmentProjects/${id}/jobCreditCost?${params}`);
}

export type AlignmentJobSettings = {
  newDatasetName: string;
  // null means the organization's root folder.
  folderId: string | null;
  renderUnaligned: boolean;
  // null means all sections.
  sectionRange: SectionRange | null;
};

export function startAlignmentProjectJob(
  id: string,
  settings: AlignmentJobSettings,
): Promise<APIJob> {
  return Request.sendJSONReceiveJSON(`/api/jobs/run/alignAlignmentProject/${id}`, {
    method: "POST",
    data: settings,
  });
}

export type AlignmentProjectUploadInfo = {
  resumableUploadInfo: {
    uploadId: string;
    totalFileCount: number;
    filePaths: string[];
    totalFileSizeInBytes: number;
  };
  name: string;
  description: string;
  organizationId: string;
  voxelSizeFactor: Vector3;
  voxelSizeUnit: string;
};

export function reserveAlignmentProjectUpload(
  datastoreUrl: string,
  uploadInfo: AlignmentProjectUploadInfo,
): Promise<void> {
  return doWithToken((token) =>
    Request.sendJSONReceiveJSON(
      `/data/datasets/upload/alignmentProject/reserveUpload?token=${token}`,
      { data: uploadInfo, host: datastoreUrl },
    ),
  );
}

export function finishAlignmentProjectUpload(
  datastoreUrl: string,
  uploadId: string,
): Promise<{ alignmentProjectId: string }> {
  return doWithToken((token) =>
    Request.receiveJSON(
      `/data/datasets/upload/alignmentProject/finishUpload?uploadId=${uploadId}&token=${token}`,
      { host: datastoreUrl, method: "POST" },
    ),
  );
}

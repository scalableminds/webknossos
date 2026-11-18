import {
  cancelDatasetUpload,
  finishDatasetUpload,
  reserveDatasetUpload,
  sendFailedRequestAnalyticsEvent,
  type UnfinishedUpload,
} from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import type ResumableUpload from "libs/resumable_upload/resumable_upload";
import Toast from "libs/toast";
import throttle from "lodash-es/throttle";
import messages from "messages";
import { useState } from "react";
import type { FileWithPath } from "react-dropzone";
import type { APITeam } from "types/api_types";
import type { UnitLong, Vector3 } from "viewer/constants";
import { getTotalFileSize } from "./detect_dataset_format";
import {
  getUploadProgress,
  groupFilesByLayer,
  markLayersAsSent,
  type UploadLayerProgress,
} from "./upload_layers";
import { generateResumableUploadId, useResumableUpload } from "./use_resumable_upload";

const REPORT_THROTTLE_THRESHOLD = 1 * 60 * 1000; // 1 min

const logRetryToAnalytics = throttle((datasetName: string) => {
  ErrorHandling.notify(new Error(`Warning: Upload of dataset ${datasetName} was retried.`));
}, REPORT_THROTTLE_THRESHOLD);

const PROGRESS_THROTTLE_INTERVAL = 200; // ms

// What is known about an upload from the moment it starts.
export type UploadInfo = {
  datasetName: string;
  needsConversion: boolean;
  // The name of the source format if it needs to be converted, e.g. "TIFF".
  formatName: string | null;
  bytesTotal: number;
  layers: UploadLayerProgress[];
};

export type UploadStatus =
  | { kind: "idle" }
  | ({ kind: "uploading"; bytesSent: number; isRetrying: boolean } & UploadInfo)
  | ({ kind: "finishing" } & UploadInfo)
  | ({ kind: "finished"; datasetId: string; conversionJobId: string | null } & UploadInfo)
  | ({
      kind: "failed";
      failedStage: "upload" | "finalize";
      message: string;
      bytesSent: number;
    } & UploadInfo);

type DatasetUploadRequest = {
  name: string;
  files: FileWithPath[];
  organizationId: string;
  initialTeams: APITeam[];
  targetFolderId: string;
  datastoreUrl: string;
  needsConversion: boolean;
  formatName: string | null;
  voxelSizeFactor?: Vector3;
  voxelSizeUnit?: UnitLong;
  unfinishedUploadToContinue: UnfinishedUpload | null;
};

export function useResumableDatasetUpload({
  onUploaded,
  onUploadAborted,
}: {
  onUploaded: (datasetId: string, datasetName: string, needsConversion: boolean) => void;
  // Called when the upload failed to finish or was cancelled, i.e., it can't be continued.
  onUploadAborted: () => void;
}) {
  const { startUpload, cancelUpload } = useResumableUpload();
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });

  const startDatasetUpload = (request: DatasetUploadRequest) => {
    const { name: datasetName, files, datastoreUrl, needsConversion } = request;
    const layerGroups = groupFilesByLayer(files);
    const uploadInfo: UploadInfo = {
      datasetName,
      needsConversion,
      formatName: request.formatName,
      bytesTotal: getTotalFileSize(files),
      layers: layerGroups.layers,
    };
    const sentUploadInfo = { ...uploadInfo, layers: markLayersAsSent(uploadInfo.layers) };
    setStatus({ kind: "uploading", ...uploadInfo, bytesSent: 0, isRetrying: false });

    const uploadId =
      request.unfinishedUploadToContinue?.uploadId ??
      generateResumableUploadId("dataset", datasetName);
    const datasetUploadInfo = {
      resumableUploadInfo: {
        uploadId,
        totalFileCount: files.length,
        filePaths: files.map((file) => file.path || ""),
        totalFileSizeInBytes: uploadInfo.bytesTotal,
      },
      datasetName,
      organizationId: request.organizationId,
      layersToLink: [],
      initialTeamIds: request.initialTeams.map((team) => team.id),
      folderId: request.targetFolderId,
      needsConversion,
      voxelSizeFactor: needsConversion ? request.voxelSizeFactor : undefined,
      voxelSizeUnit: needsConversion ? request.voxelSizeUnit : undefined,
    };

    // Progress events fire for every chunk, so computing the progress per layer is throttled.
    const updateProgress = throttle((resumableUpload: ResumableUpload) => {
      const { bytesSent, layers } = getUploadProgress(layerGroups, resumableUpload.files);
      setStatus((previous) =>
        previous.kind === "uploading"
          ? {
              ...previous,
              isRetrying: false,
              // Don't let the progress go back, e.g. when a chunk is retried.
              bytesSent: Math.max(previous.bytesSent, bytesSent),
              layers,
            }
          : previous,
      );
    }, PROGRESS_THROTTLE_INTERVAL);

    return startUpload({
      name: datasetName,
      files,
      datastoreUrl,
      uploadId,
      uploadDomain: "dataset",
      reserve: () => reserveDatasetUpload(datastoreUrl, datasetUploadInfo),
      onStartFailed: () => setStatus({ kind: "idle" }),
      onProgress: updateProgress,
      onRetry: () => {
        logRetryToAnalytics(datasetName);
        setStatus((previous) =>
          previous.kind === "uploading" ? { ...previous, isRetrying: true } : previous,
        );
      },
      finish: () => {
        updateProgress.cancel();
        setStatus({ kind: "finishing", ...sentUploadInfo });
        return finishDatasetUpload(datastoreUrl, uploadId);
      },
      onFinished: ({ datasetId, conversionJobId }) => {
        setStatus({
          kind: "finished",
          ...sentUploadInfo,
          datasetId,
          conversionJobId: conversionJobId ?? null,
        });
        onUploaded(datasetId, datasetName, needsConversion);
      },
      onFinishFailed: (error) => {
        sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
          dataset_name: datasetName,
        });
        setStatus({
          kind: "failed",
          ...sentUploadInfo,
          bytesSent: sentUploadInfo.bytesTotal,
          failedStage: "finalize",
          message: messages["dataset.upload_failed"],
        });
        onUploadAborted();
      },
      // The files already sent are kept on the server, so that the upload can still be
      // continued via the list of unfinished uploads.
      onFileError: (message) => {
        updateProgress.cancel();
        setStatus((previous) =>
          previous.kind === "uploading"
            ? { ...previous, kind: "failed", failedStage: "upload", message }
            : previous,
        );
      },
      cancel: async () => {
        await cancelDatasetUpload(datastoreUrl, uploadId);
        Toast.success(messages["dataset.upload_cancel"]);
      },
      onCancelled: () => {
        updateProgress.cancel();
        setStatus({ kind: "idle" });
        onUploadAborted();
      },
    });
  };

  // Closes the dialog of a finished or failed upload.
  const reset = () => setStatus({ kind: "idle" });

  return { status, startUpload: startDatasetUpload, cancelUpload, reset };
}

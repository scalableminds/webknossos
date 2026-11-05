import {
  cancelDatasetUpload,
  finishDatasetUpload,
  reserveDatasetUpload,
  sendFailedRequestAnalyticsEvent,
  type UnfinishedUpload,
} from "admin/rest_api";
import dayjs from "dayjs";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import throttle from "lodash-es/throttle";
import messages from "messages";
import type { FileWithPath } from "react-dropzone";
import type { APITeam } from "types/api_types";
import type { UnitLong, Vector3 } from "viewer/constants";
import { getTotalFileSize } from "./detect_dataset_format";
import { getRandomString, useResumableUpload } from "./use_resumable_upload";

const REPORT_THROTTLE_THRESHOLD = 1 * 60 * 1000; // 1 min

const logRetryToAnalytics = throttle((datasetName: string) => {
  ErrorHandling.notify(new Error(`Warning: Upload of dataset ${datasetName} was retried.`));
}, REPORT_THROTTLE_THRESHOLD);

type DatasetUploadRequest = {
  name: string;
  files: FileWithPath[];
  organizationId: string;
  initialTeams: APITeam[];
  targetFolderId: string;
  datastoreUrl: string;
  needsConversion: boolean;
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
  const { status, startUpload, cancelUpload } = useResumableUpload();

  const startDatasetUpload = (request: DatasetUploadRequest) => {
    const { name: datasetName, files, datastoreUrl, needsConversion } = request;
    const uploadId =
      request.unfinishedUploadToContinue?.uploadId ??
      `${dayjs(Date.now()).format("YYYY-MM-DD_HH-mm")}__${datasetName}__${getRandomString()}`;
    const datasetUploadInfo = {
      resumableUploadInfo: {
        uploadId,
        totalFileCount: files.length,
        filePaths: files.map((file) => file.path || ""),
        totalFileSizeInBytes: getTotalFileSize(files),
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

    return startUpload({
      name: datasetName,
      files,
      datastoreUrl,
      uploadId,
      uploadDomain: "dataset",
      reserve: () => reserveDatasetUpload(datastoreUrl, datasetUploadInfo),
      finish: () => finishDatasetUpload(datastoreUrl, uploadId),
      onFinished: ({ datasetId }) => onUploaded(datasetId, datasetName, needsConversion),
      onFinishFailed: (error) => {
        sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
          dataset_name: datasetName,
        });
        Toast.error(messages["dataset.upload_failed"]);
        onUploadAborted();
      },
      onFileError: (message) => Toast.error(message),
      onRetry: () => logRetryToAnalytics(datasetName),
      cancel: async () => {
        await cancelDatasetUpload(datastoreUrl, uploadId);
        Toast.success(messages["dataset.upload_cancel"]);
      },
      onCancelled: onUploadAborted,
    });
  };

  return { status, startUpload: startDatasetUpload, cancelUpload };
}

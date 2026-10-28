import {
  cancelDatasetUpload,
  createResumableUpload,
  finishDatasetUpload,
  refreshToken,
  reserveDatasetUpload,
  sendFailedRequestAnalyticsEvent,
  type UnfinishedUpload,
} from "admin/rest_api";
import { App } from "antd";
import dayjs from "dayjs";
import ErrorHandling from "libs/error_handling";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import Toast from "libs/toast";
import throttle from "lodash-es/throttle";
import messages from "messages";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileWithPath } from "react-dropzone";
import { useBlocker } from "react-router";
import type { APITeam } from "types/api_types";
import type { UnitLong, Vector3 } from "viewer/constants";
import { getTotalFileSize } from "./detect_dataset_format";
import {
  getUploadProgress,
  groupFilesByLayer,
  markLayersAsSent,
  type UploadLayerProgress,
} from "./upload_layers";

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

type ActiveUpload = {
  uploadId: string;
  datastoreUrl: string;
  resumableUpload: any;
  // Set if all files were sent while the cancel dialog was open.
  isFinishPending: boolean;
  finishUpload: () => void;
};

function getRandomString() {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(randomBytes, (byte) => `0${byte.toString(16)}`.slice(-2)).join("");
}

/** Blocks in-app navigation and page unloads while an upload is running. */
function useBlockNavigationWhile(isBlocking: boolean) {
  const blocker = useBlocker(
    useCallback(() => isBlocking && !confirm(messages["save.leave_page_unfinished"]), [isBlocking]),
  );

  useEffect(() => {
    // The user chose to stay on the page.
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);

  useEffect(() => {
    if (!isBlocking) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only show the prompt if returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isBlocking]);
}

export function useResumableDatasetUpload({
  onUploaded,
  onUploadAborted,
}: {
  onUploaded: (datasetId: string, datasetName: string, needsConversion: boolean) => void;
  // Called when the upload failed to finish or was cancelled, i.e., it can't be continued.
  onUploadAborted: () => void;
}) {
  const { modal } = App.useApp();
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const activeUploadRef = useRef<ActiveUpload | null>(null);
  // Set to true when the user initiates a cancel (before the confirmation dialog is resolved)
  // to defer finishDatasetUpload until the user decided to keep the upload.
  const isCancellingRef = useRef(false);

  useBlockNavigationWhile(status.kind === "uploading" || status.kind === "finishing");

  const startUpload = async (request: DatasetUploadRequest) => {
    const { name: datasetName, files, datastoreUrl, needsConversion } = request;
    isCancellingRef.current = false;
    const layerGroups = groupFilesByLayer(files);
    const uploadInfo: UploadInfo = {
      datasetName,
      needsConversion,
      formatName: request.formatName,
      bytesTotal: getTotalFileSize(files),
      layers: layerGroups.layers,
    };
    setStatus({ kind: "uploading", ...uploadInfo, bytesSent: 0, isRetrying: false });

    const uploadId =
      request.unfinishedUploadToContinue?.uploadId ??
      `${dayjs(Date.now()).format("YYYY-MM-DD_HH-mm")}__${datasetName}__${getRandomString()}`;
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

    let resumableUpload: any;
    try {
      await refreshToken();
      await reserveDatasetUpload(datastoreUrl, datasetUploadInfo);
      resumableUpload = await createResumableUpload(datastoreUrl, uploadId);
    } catch (error) {
      // The request library already notified the user.
      console.error(error);
      setStatus({ kind: "idle" });
      return;
    }
    const sentUploadInfo = { ...uploadInfo, layers: markLayersAsSent(uploadInfo.layers) };
    // Progress events fire for every chunk, so computing the progress per layer is throttled.
    const updateProgress = throttle(() => {
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

    let finishUploadCalled = false;
    const finishUpload = () => {
      if (finishUploadCalled) return;
      finishUploadCalled = true;
      updateProgress.cancel();
      setStatus({ kind: "finishing", ...sentUploadInfo });
      finishDatasetUpload(datastoreUrl, uploadId).then(
        ({ datasetId, conversionJobId }) => {
          activeUploadRef.current = null;
          setStatus({
            kind: "finished",
            ...sentUploadInfo,
            datasetId,
            conversionJobId: conversionJobId ?? null,
          });
          onUploaded(datasetId, datasetName, needsConversion);
        },
        (error) => {
          sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
            dataset_name: datasetName,
          });
          activeUploadRef.current = null;
          setStatus({
            kind: "failed",
            ...sentUploadInfo,
            bytesSent: sentUploadInfo.bytesTotal,
            failedStage: "finalize",
            message: messages["dataset.upload_failed"],
          });
          onUploadAborted();
        },
      );
    };
    const activeUpload: ActiveUpload = {
      uploadId,
      datastoreUrl,
      resumableUpload,
      isFinishPending: false,
      finishUpload,
    };
    activeUploadRef.current = activeUpload;

    resumableUpload.addEventListener("complete", (event: ResumableUploadEvent) => {
      if (event.detail.type !== "complete" || !event.detail.didUploadCompleteSuccessfully) {
        // A retry might be initiated by other code that listens to fileError events which is
        // why we ignore the complete event now. The type is only checked to satisfy TS.
        return;
      }
      resumableUpload.pause();
      if (isCancellingRef.current) {
        // Finish once the user decided to keep the upload.
        activeUpload.isFinishPending = true;
        return;
      }
      finishUpload();
    });
    resumableUpload.addEventListener("filesAdded", () => {
      resumableUpload.upload();
    });
    // terminalFileError is triggered by the RestApi when a normal fileError could not be
    // recovered by refreshing the user token.
    resumableUpload.addEventListener("terminalFileError", (event: ResumableUploadEvent) => {
      if (event.detail.type !== "terminalFileError") {
        // Satisfy TS.
        return;
      }
      updateProgress.cancel();
      // Stop the upload locally. The files already sent are kept on the server, so that the
      // upload can still be continued via the list of unfinished uploads. Note that cancel()
      // would emit a successful "complete" event once all files are removed.
      resumableUpload.pause();
      activeUploadRef.current = null;
      const { message } = event.detail;
      setStatus((previous) =>
        previous.kind === "uploading"
          ? { ...previous, kind: "failed", failedStage: "upload", message }
          : previous,
      );
    });
    resumableUpload.addEventListener("progress", updateProgress);
    resumableUpload.addEventListener("fileRetry", () => {
      logRetryToAnalytics(datasetName);
      setStatus((previous) =>
        previous.kind === "uploading" ? { ...previous, isRetrying: true } : previous,
      );
    });
    resumableUpload.addFiles(files as File[]);
  };

  const cancelUpload = async () => {
    const activeUpload = activeUploadRef.current;
    if (activeUpload == null) return;
    // The upload keeps running while the user decides.
    isCancellingRef.current = true;
    const shouldCancel = await modal.warning({
      title:
        "Cancelling the running upload will delete already uploaded files on the server and cannot be undone. Are you sure you want to cancel the upload?",
      okText: "Yes, cancel the upload",
      okButtonProps: { danger: true },
      okCancel: true,
      cancelText: "No, keep it running",
    });

    if (!shouldCancel) {
      isCancellingRef.current = false;
      if (activeUpload.isFinishPending) activeUpload.finishUpload();
      return;
    }

    activeUpload.resumableUpload.cancel();
    try {
      await cancelDatasetUpload(activeUpload.datastoreUrl, activeUpload.uploadId);
      Toast.success(messages["dataset.upload_cancel"]);
    } catch (error) {
      // The request library already notified the user.
      console.error(error);
    } finally {
      activeUploadRef.current = null;
      setStatus({ kind: "idle" });
      onUploadAborted();
    }
  };

  // Closes the dialog of a finished or failed upload.
  const reset = () => setStatus({ kind: "idle" });

  return { status, startUpload, cancelUpload, reset };
}

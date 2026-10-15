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

const REPORT_THROTTLE_THRESHOLD = 1 * 60 * 1000; // 1 min

const logRetryToAnalytics = throttle((datasetName: string) => {
  ErrorHandling.notify(new Error(`Warning: Upload of dataset ${datasetName} was retried.`));
}, REPORT_THROTTLE_THRESHOLD);

export type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; datasetName: string; progress: number; isRetrying: boolean }
  | { kind: "finishing"; datasetName: string };

export type DatasetUploadRequest = {
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

type ActiveUpload = {
  uploadId: string;
  datastoreUrl: string;
  resumableUpload: any;
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
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isBlocking]);
}

export function useResumableDatasetUpload(
  onUploaded: (datasetId: string, datasetName: string, needsConversion: boolean) => void,
) {
  const { modal } = App.useApp();
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const activeUploadRef = useRef<ActiveUpload | null>(null);
  // Set to true when the user initiates a cancel (before the confirmation dialog is resolved)
  // to prevent the `complete` event from triggering finishDatasetUpload in the meantime.
  const isCancellingRef = useRef(false);

  useBlockNavigationWhile(status.kind !== "idle");

  const startUpload = async (request: DatasetUploadRequest) => {
    const { name: datasetName, files, datastoreUrl, needsConversion } = request;
    isCancellingRef.current = false;
    setStatus({ kind: "uploading", datasetName, progress: 0, isRetrying: false });

    const uploadId =
      request.unfinishedUploadToContinue?.uploadId ??
      `${dayjs(Date.now()).format("YYYY-MM-DD_HH-mm")}__${datasetName}__${getRandomString()}`;
    const datasetUploadInfo = {
      resumableUploadInfo: {
        uploadId,
        totalFileCount: files.length,
        filePaths: files.map((file) => file.path || ""),
        totalFileSizeInBytes: files.reduce((sum, file) => sum + file.size, 0),
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
    activeUploadRef.current = { uploadId, datastoreUrl, resumableUpload };

    let finishUploadCalled = false;
    resumableUpload.addEventListener("complete", (event: ResumableUploadEvent) => {
      if (
        event.detail.type !== "complete" ||
        !event.detail.didUploadCompleteSuccessfully ||
        isCancellingRef.current ||
        finishUploadCalled
      ) {
        // The upload was not successful, or a cancel was initiated before the complete event
        // fired (e.g. the last in-flight chunk completed while the cancel dialog was open).
        // A retry might be initiated by other code that listens to fileError events which is
        // why we ignore the complete event now. The type is only checked to satisfy TS.
        return;
      }
      finishUploadCalled = true;
      resumableUpload.pause();
      setStatus({ kind: "finishing", datasetName });
      finishDatasetUpload(datastoreUrl, uploadId).then(
        ({ datasetId }) => {
          activeUploadRef.current = null;
          setStatus({ kind: "idle" });
          onUploaded(datasetId, datasetName, needsConversion);
        },
        (error) => {
          sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
            dataset_name: datasetName,
          });
          Toast.error(messages["dataset.upload_failed"]);
          activeUploadRef.current = null;
          setStatus({ kind: "idle" });
        },
      );
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
      Toast.error(event.detail.message);
      setStatus({ kind: "idle" });
    });
    resumableUpload.addEventListener("progress", () => {
      setStatus((previous) =>
        previous.kind === "uploading"
          ? { ...previous, isRetrying: false, progress: resumableUpload.progress() }
          : previous,
      );
    });
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
    isCancellingRef.current = true;
    activeUpload.resumableUpload.pause();
    const shouldCancel = await modal.confirm({
      title:
        "Cancelling the running upload will delete already uploaded files on the server and cannot be undone. Are you sure you want to cancel the upload?",
      okText: "Yes, cancel the upload",
      cancelText: "No, keep it running",
    });

    if (!shouldCancel) {
      isCancellingRef.current = false;
      activeUpload.resumableUpload.upload();
      return;
    }

    activeUpload.resumableUpload.cancel();
    await cancelDatasetUpload(activeUpload.datastoreUrl, activeUpload.uploadId);
    activeUploadRef.current = null;
    setStatus({ kind: "idle" });
    Toast.success(messages["dataset.upload_cancel"]);
  };

  return { status, startUpload, cancelUpload };
}

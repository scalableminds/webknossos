import { createResumableUpload, refreshToken } from "admin/rest_api";
import { App } from "antd";
import type ResumableUpload from "libs/resumable_upload/resumable_upload";
import type { ResumableUploadEvent } from "libs/resumable_upload/resumable_upload";
import messages from "messages";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileWithPath } from "react-dropzone";
import { useBlocker } from "react-router";

export type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; name: string; progress: number; isRetrying: boolean }
  | { kind: "finishing"; name: string };

export type ResumableUploadRequest<FinishResult> = {
  name: string;
  files: FileWithPath[];
  datastoreUrl: string;
  uploadId: string;
  uploadDomain: "dataset" | "alignmentProject";
  // Registers the upload with WEBKNOSSOS before any file is sent.
  reserve: () => Promise<void>;
  // Called when the upload could not be started. The request library already notified the user.
  onStartFailed?: () => void;
  finish: () => Promise<FinishResult>;
  onFinished: (result: FinishResult) => void;
  onFinishFailed: (error: Record<string, any>) => void;
  // A file could not be uploaded, even after refreshing the user token.
  onFileError: (message: string) => void;
  onRetry?: () => void;
  // Removes the already uploaded files on the server after the user confirmed to cancel.
  cancel: () => Promise<void>;
  // Called after a confirmed cancel, regardless of whether cancelling on the server succeeded.
  onCancelled?: () => void;
};

type ActiveUpload = {
  request: ResumableUploadRequest<any>;
  resumableUpload: ResumableUpload;
};

export function getRandomString() {
  const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(randomBytes, (byte) => `0${byte.toString(16)}`.slice(-2)).join("");
}

// Counts the running uploads of all useResumableUpload instances, because a router only
// consults one navigation blocker. See useBlockNavigationDuringUploads.
let runningUploadCount = 0;

/**
 * Blocks in-app navigation while any upload is running. Call it once in each page that hosts
 * upload views, instead of in every upload hook.
 */
export function useBlockNavigationDuringUploads() {
  const blocker = useBlocker(
    useCallback(
      () => runningUploadCount > 0 && !confirm(messages["save.leave_page_unfinished"]),
      [],
    ),
  );

  useEffect(() => {
    // The user chose to stay on the page.
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
}

function useBlockPageUnloadWhile(isBlocking: boolean) {
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

/**
 * Runs a resumable upload to a datastore: reserve, upload the files, finish. The steps that
 * differ per upload domain are passed with each request.
 */
export function useResumableUpload() {
  const { modal } = App.useApp();
  const [status, setStatusState] = useState<UploadStatus>({ kind: "idle" });
  const isUploadingRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const activeUploadRef = useRef<ActiveUpload | null>(null);
  // Set to true when the user initiates a cancel (before the confirmation dialog is resolved)
  // to prevent the `complete` event from triggering finish in the meantime.
  const isCancellingRef = useRef(false);

  // Updates the running upload count right away, so that navigating right after an upload
  // finished is not blocked by the not yet re-rendered state.
  const setStatus = useCallback((nextStatus: UploadStatus) => {
    const isUploading = nextStatus.kind !== "idle";
    if (isUploading !== isUploadingRef.current && !isUnmountedRef.current) {
      runningUploadCount += isUploading ? 1 : -1;
    }
    isUploadingRef.current = isUploading;
    setStatusState(nextStatus);
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      if (isUploadingRef.current) runningUploadCount--;
      // An upload that keeps running after unmount must not change the count anymore.
      isUnmountedRef.current = true;
    };
  }, []);

  useBlockPageUnloadWhile(status.kind !== "idle");

  const startUpload = async <FinishResult>(request: ResumableUploadRequest<FinishResult>) => {
    const { name, files, datastoreUrl, uploadId } = request;
    isCancellingRef.current = false;
    setStatus({ kind: "uploading", name, progress: 0, isRetrying: false });

    let resumableUpload: ResumableUpload;
    try {
      await refreshToken();
      await request.reserve();
      resumableUpload = await createResumableUpload(datastoreUrl, uploadId, request.uploadDomain);
    } catch (error) {
      // The request library already notified the user.
      console.error(error);
      setStatus({ kind: "idle" });
      request.onStartFailed?.();
      return;
    }
    activeUploadRef.current = { request, resumableUpload };

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
      setStatus({ kind: "finishing", name });
      request.finish().then(
        (result) => {
          activeUploadRef.current = null;
          setStatus({ kind: "idle" });
          request.onFinished(result);
        },
        (error) => {
          activeUploadRef.current = null;
          setStatus({ kind: "idle" });
          request.onFinishFailed(error);
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
      // Stop uploading the remaining files.
      resumableUpload.cancel();
      activeUploadRef.current = null;
      setStatus({ kind: "idle" });
      request.onFileError(event.detail.message);
    });
    resumableUpload.addEventListener("progress", () => {
      setStatusState((previous) =>
        previous.kind === "uploading"
          ? { ...previous, isRetrying: false, progress: resumableUpload.progress() }
          : previous,
      );
    });
    resumableUpload.addEventListener("fileRetry", () => {
      request.onRetry?.();
      setStatusState((previous) =>
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
    try {
      await activeUpload.request.cancel();
    } catch (error) {
      // The request library already notified the user.
      console.error(error);
    } finally {
      activeUploadRef.current = null;
      setStatus({ kind: "idle" });
      activeUpload.request.onCancelled?.();
    }
  };

  return { status, startUpload, cancelUpload };
}

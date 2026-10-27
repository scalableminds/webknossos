import type { ResumableFile } from "./resumable_file";
import { getTargetURI } from "./resumable_shared";
import type { ConfigurationHash, ResumableUpload } from "./resumable_upload";

/**
 * Represents a single chunk of a file to be uploaded.
 */
export class ResumableChunk {
  opts: Partial<ConfigurationHash> = {};
  resumableObj: ResumableUpload;
  fileObj: ResumableFile;
  fileObjSize: number;
  fileObjType: string;
  offset: number;
  callback: (event: "progress" | "success" | "error" | "retry", message?: string) => void;
  lastProgressCallback: Date;
  tested = false;
  retries = 0;
  pendingRetry = false;
  markComplete = false;
  startByte: number;
  endByte: number;

  // Created by send() and aborted by abort(). Every probe, upload and retry wait of one
  // run observes its signal, so an aborted run can neither restart nor change the chunk's state.
  private runController: AbortController | null = null;
  private _status: "pending" | "uploading" | "success" | "error" = "pending";
  private _message: string = "";

  constructor(
    resumableObj: ResumableUpload,
    fileObj: ResumableFile,
    offset: number,
    callback: (event: "progress" | "success" | "error" | "retry", message?: string) => void,
  ) {
    this.resumableObj = resumableObj;
    this.fileObj = fileObj;
    this.fileObjSize = fileObj.size;
    this.fileObjType = fileObj.file.type;
    this.offset = offset;
    this.callback = callback;
    this.lastProgressCallback = new Date();

    const chunkSize = this.getOpt("chunkSize") as number;
    this.startByte = this.offset * chunkSize;
    this.endByte = Math.min(this.fileObjSize, (this.offset + 1) * chunkSize);

    if (this.fileObjSize - this.endByte < chunkSize && !this.getOpt("forceChunkSize")) {
      this.endByte = this.fileObjSize;
    }
  }

  getOpt<T extends keyof ConfigurationHash>(key: T): Required<ConfigurationHash>[T] {
    if (this.opts[key] !== undefined) {
      return this.opts[key] as Required<ConfigurationHash>[T];
    }
    return this.fileObj.getOpt(key);
  }

  // send() starts uploading the chunk. If testChunks is enabled, the server is asked first
  // whether it already has the chunk.
  send(): void {
    // Never run two probes/uploads for the same chunk concurrently.
    if (this._status === "uploading") return;

    const runController = new AbortController();
    this.runController = runController;
    // Probing counts as uploading so that the scheduler, pause and cancel take it into account.
    this._status = "uploading";
    this.run(runController.signal).catch((error) => {
      if (runController.signal.aborted) return;
      if (this._status !== "uploading") {
        // The chunk already finished, e.g. a success or error callback threw.
        console.error(error);
        return;
      }
      // E.g. a query or headers option threw or the file could not be read.
      this.finish("error", error instanceof Error ? error.message : String(error));
    });
  }

  private async run(signal: AbortSignal): Promise<void> {
    if (this.getOpt("testChunks") && !this.tested) {
      const existingChunkMessage = await this.test(signal);
      if (signal.aborted) return;
      this.tested = true;
      if (existingChunkMessage != null) {
        this.markComplete = true;
        this.finish("success", existingChunkMessage);
        return;
      }
    }

    for (;;) {
      const retryReason = await this.upload(signal);
      if (retryReason == null || signal.aborted) return;

      this.callback("retry", retryReason);
      // A retry listener may have paused or cancelled the upload.
      if (signal.aborted) return;
      this.retries++;

      const retryInterval = this.getOpt("chunkRetryInterval");
      if (retryInterval != null) {
        this.pendingRetry = true;
        await abortableSleep(retryInterval, signal);
        if (signal.aborted) return;
        this.pendingRetry = false;
      }
    }
  }

  // test() checks whether the chunk already exists on the server in a GET call.
  // Resolves to the server's message if it does and to null if the chunk needs to be uploaded.
  private async test(signal: AbortSignal): Promise<string | null> {
    let customQueryParameters = this.getOpt("query");

    if (typeof customQueryParameters === "function") {
      customQueryParameters = customQueryParameters(this.fileObj, this);
    }

    const queryParams = Object.assign({}, customQueryParameters || {});

    const extraParams: Partial<Record<string, any>> = {
      [this.getOpt("chunkNumberParameterName")]: this.offset + 1,
      [this.getOpt("chunkSizeParameterName")]: this.getOpt("chunkSize"),
      [this.getOpt("currentChunkSizeParameterName")]: this.endByte - this.startByte,
      [this.getOpt("totalSizeParameterName")]: this.fileObjSize,
      [this.getOpt("typeParameterName")]: this.fileObjType,
      [this.getOpt("identifierParameterName")]: this.fileObj.uniqueIdentifier,
      [this.getOpt("fileNameParameterName")]: this.fileObj.fileName,
      [this.getOpt("relativePathParameterName")]: this.fileObj.relativePath,
      [this.getOpt("totalChunksParameterName")]: this.fileObj.chunks.length,
    };

    const targetUrl = getTargetURI(this.resumableObj, {
      ...queryParams,
      ...extraParams,
    });

    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }

    const fetchSignal = this.withFetchTimeout(signal);
    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: customHeaders,
        signal: fetchSignal.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });
      // Status 200: chunk already exists on server
      // Status 204: chunk does not exist on server, please upload
      if (response.ok && response.status !== 204) {
        return await response.text();
      }
      discardBody(response);
    } catch (_error) {
      // Aborted, timed out or failed: run() either stops or falls back to uploading the chunk.
    } finally {
      fetchSignal.dispose();
    }
    return null;
  }

  // upload() uploads the actual data in a POST call.
  // Resolves to the reason for a retry if the upload should be retried and to null otherwise.
  private async upload(signal: AbortSignal): Promise<string | null> {
    this.callback("progress");

    const standardQueryParameters: Partial<Record<string, any>> = {
      [this.getOpt("chunkNumberParameterName")]: this.offset + 1,
      [this.getOpt("chunkSizeParameterName")]: this.getOpt("chunkSize"),
      [this.getOpt("currentChunkSizeParameterName")]: this.endByte - this.startByte,
      [this.getOpt("totalSizeParameterName")]: this.fileObjSize,
      [this.getOpt("typeParameterName")]: this.fileObjType,
      [this.getOpt("identifierParameterName")]: this.fileObj.uniqueIdentifier,
      [this.getOpt("fileNameParameterName")]: this.fileObj.fileName,
      [this.getOpt("relativePathParameterName")]: this.fileObj.relativePath,
      [this.getOpt("totalChunksParameterName")]: this.fileObj.chunks.length,
    };

    let customQueryParameters = this.getOpt("query");
    if (typeof customQueryParameters === "function") {
      customQueryParameters = customQueryParameters(this.fileObj, this);
    }
    const queryParameters = Object.assign(standardQueryParameters, customQueryParameters || {});

    const bytes = this.fileObj.file.slice(
      this.startByte,
      this.endByte,
      this.getOpt("setChunkTypeFromFile") ? this.fileObj.file.type : "",
    );

    let data: FormData | Blob | string;

    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }
    const headers: Record<string, string> = Object.assign({}, customHeaders);

    const formData = new FormData();
    // Add data from the query options
    Object.entries(queryParameters).forEach(([k, v]) => {
      formData.append(k, v);
    });

    if (this.getOpt("chunkFormat") === "blob") {
      formData.append(this.getOpt("fileParameterName"), bytes, this.fileObj.fileName);
      data = formData;
    } else {
      // chunkFormat == base64
      const readPromise = new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(bytes);
      });
      const base64Data = await readPromise;
      if (signal.aborted) return null;
      formData.append(this.getOpt("fileParameterName"), base64Data);
      data = formData;
    }

    const targetUrl = getTargetURI(this.resumableObj, queryParameters);
    const fetchSignal = this.withFetchTimeout(signal);

    let status: "success" | "error";
    let message: string;
    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: data,
        signal: fetchSignal.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });

      if (response.ok) {
        status = "success";
      } else if (
        this.getOpt("permanentErrors").includes(response.status) ||
        this.retries >= this.getOpt("maxChunkRetries")
      ) {
        status = "error";
      } else {
        discardBody(response);
        return `Server responded with ${response.status}`;
      }
      message = await response.text();
    } catch (error: any) {
      if (signal.aborted) return null;
      // Network errors and timeouts are retried indefinitely, only HTTP errors count
      // towards maxChunkRetries.
      return fetchSignal.hasTimedOut() ? "Timeout" : error.message;
    } finally {
      fetchSignal.dispose();
    }

    if (signal.aborted) return null;
    // Outside of the try block, so that an error thrown by a callback isn't mistaken for a
    // network error, which would upload the finished chunk again.
    this.finish(status, message);
    return null;
  }

  // Combines the run's signal with the fetchTimeout option. dispose() must be called once the
  // request has finished so that neither the timer nor the abort listener outlive it.
  private withFetchTimeout(signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    // A synchronous listener (e.g. of the progress callback) may already have aborted the run.
    // The abort event doesn't fire again for it.
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });

    const fetchTimeout = this.getOpt("fetchTimeout");
    let hasTimedOut = false;
    const timeoutId =
      fetchTimeout > 0
        ? setTimeout(() => {
            hasTimedOut = true;
            controller.abort();
          }, fetchTimeout)
        : null;

    return {
      signal: controller.signal,
      hasTimedOut: () => hasTimedOut,
      dispose: () => {
        if (timeoutId != null) clearTimeout(timeoutId);
        signal.removeEventListener("abort", abort);
      },
    };
  }

  private finish(status: "success" | "error", message: string): void {
    this._status = status;
    this._message = message;
    this.callback(status, message);
    this.resumableObj.uploadNextChunk();
  }

  abort(): void {
    // Stops in-flight requests and pending retries of this chunk.
    this.runController?.abort();
    this.runController = null;
    this.pendingRetry = false;
    this._status = "pending";
  }

  status(): "pending" | "uploading" | "success" | "error" {
    // if pending retry then that's effectively the same as actively uploading,
    // there might just be a slight delay before the retry starts
    if (this.pendingRetry) return "uploading";
    if (this.markComplete) return "success";
    return this._status;
  }

  message(): string {
    return this._message;
  }

  progress(relative = false): number {
    // NOTE: the fetch API doesn't provide a way to get the progress of the upload so we need to track the uploaded bytes ourselves
    let factor = relative ? (this.endByte - this.startByte) / this.fileObjSize : 1;
    if (this.pendingRetry) return 0;
    if (this.status() === "uploading" && !this.markComplete) factor *= 0.95;

    const s = this.status();
    switch (s) {
      case "success":
      case "error":
        return 1 * factor;
      case "pending":
      default:
        return 0;
    }
  }
}

// Releases the connection of a response whose body is not needed.
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {});
}

// Resolves after ms or as soon as the signal is aborted. Removes its abort listener when the
// timer fires, because a run may wait many times on the same signal.
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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

  private abortController: AbortController | null = null;
  private retryTimeoutId: ReturnType<typeof setTimeout> | null = null;
  // Incremented whenever the chunk is started or aborted. In-flight requests and retry
  // timers compare it against the value they were started with to detect that they are stale.
  private attempt = 0;
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

  private isStale(attempt: number): boolean {
    return attempt !== this.attempt;
  }

  // send() starts uploading the chunk. If testChunks is enabled, the server is asked first
  // whether it already has the chunk.
  send(): void {
    // Never run two probes/uploads for the same chunk concurrently.
    if (this._status === "uploading" || this.pendingRetry) return;

    const attempt = ++this.attempt;
    // Probing counts as uploading so that the scheduler, pause and cancel take it into account.
    this._status = "uploading";
    if (this.getOpt("testChunks") && !this.tested) {
      this.test(attempt);
    } else {
      this.upload(attempt);
    }
  }

  // test() checks whether the chunk already exists on the server in a GET call
  private async test(attempt: number): Promise<void> {
    const abortController = new AbortController();
    this.abortController = abortController;

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

    const fetchTimeout = this.getOpt("fetchTimeout");
    const timeoutId =
      fetchTimeout > 0 ? setTimeout(() => abortController.abort(), fetchTimeout) : null;

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: customHeaders,
        signal: abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });
      if (timeoutId != null) clearTimeout(timeoutId);
      if (this.isStale(attempt)) return;
      this.tested = true;

      // Status 200: chunk already exists on server
      // Status 204: chunk does not exist on server, please upload
      if (response.ok && response.status !== 204) {
        const message = await response.text();
        if (this.isStale(attempt)) return;
        this.markComplete = true;
        this._status = "success";
        this._message = message;
        this.callback("success", this._message);
        this.resumableObj.uploadNextChunk();
      } else {
        this.upload(attempt);
      }
    } catch (_error) {
      if (timeoutId != null) clearTimeout(timeoutId);
      // Aborted by abort()
      if (this.isStale(attempt)) return;

      this.tested = true;
      this.upload(attempt);
    }
  }

  // upload() uploads the actual data in a POST call
  private async upload(attempt: number): Promise<void> {
    const abortController = new AbortController();
    this.abortController = abortController;
    this.pendingRetry = false;
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
      const readPromise = new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(bytes);
      });
      const base64Data = await readPromise;
      if (this.isStale(attempt)) return;
      formData.append(this.getOpt("fileParameterName"), base64Data);
      data = formData;
    }

    const targetUrl = getTargetURI(this.resumableObj, queryParameters);
    const fetchTimeout = this.getOpt("fetchTimeout");
    let hasTimedOut = false;
    const timeoutId =
      fetchTimeout > 0
        ? setTimeout(() => {
            hasTimedOut = true;
            abortController.abort();
          }, fetchTimeout)
        : null;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: data,
        signal: abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });
      if (timeoutId != null) clearTimeout(timeoutId);
      if (this.isStale(attempt)) return;

      if (response.ok) {
        const message = await response.text();
        if (this.isStale(attempt)) return;
        this._status = "success";
        this._message = message;
        this.callback("success", this._message);
        this.resumableObj.uploadNextChunk();
      } else if (
        this.getOpt("permanentErrors").includes(response.status) ||
        this.retries >= this.getOpt("maxChunkRetries")
      ) {
        const message = await response.text();
        if (this.isStale(attempt)) return;
        this._status = "error";
        this._message = message;
        this.callback("error", this._message);
        this.resumableObj.uploadNextChunk();
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (error: any) {
      if (timeoutId != null) clearTimeout(timeoutId);
      // Aborted by abort()
      if (this.isStale(attempt)) return;

      this.callback("retry", hasTimedOut ? "Timeout" : error.message);
      // A retry listener may have paused or cancelled the upload.
      if (this.isStale(attempt)) return;
      this.abortController = null;
      this.retries++;

      const retryInterval = this.getOpt("chunkRetryInterval");
      if (retryInterval != null) {
        this.pendingRetry = true;
        this.retryTimeoutId = setTimeout(() => {
          this.retryTimeoutId = null;
          if (!this.isStale(attempt)) this.upload(attempt);
        }, retryInterval);
      } else {
        this.upload(attempt);
      }
    }
  }

  abort(): void {
    // Invalidates all in-flight requests and pending retries of this chunk.
    this.attempt++;
    if (this.retryTimeoutId != null) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    this.pendingRetry = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
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

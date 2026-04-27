import type { ResumableFile } from "./resumable_file";
import { getTargetURI } from "./resumable_shared";
import type { ConfigurationHash, ResumableUpload } from "./resumable_upload";

type ResumableChunkState = "pending" | "uploading" | "success" | "error";
type ResumableChunkRequestParams = {
  resumableChunkNumber: number;
  resumableChunkSize: number;
  resumableCurrentChunkSize: number;
  resumableTotalSize: number;
  resumableType: string;
  resumableIdentifier: string;
  resumableFilename: string;
  resumableRelativePath: string;
  resumableTotalChunks: number;
};

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
  private _status: ResumableChunkState = "pending";
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

  async test(): Promise<void> {
    this.abortController = new AbortController();

    let customQueryParameters = this.getOpt("query");

    if (typeof customQueryParameters === "function") {
      customQueryParameters = customQueryParameters(this.fileObj, this);
    }

    const queryParams: ResumableChunkRequestParams = {
      resumableChunkNumber: this.offset + 1,
      resumableChunkSize: this.getOpt("chunkSize"),
      resumableCurrentChunkSize: this.endByte - this.startByte,
      resumableTotalSize: this.fileObjSize,
      resumableType: this.fileObjType,
      resumableIdentifier: this.fileObj.uniqueIdentifier,
      resumableFilename: this.fileObj.fileName,
      resumableRelativePath: this.fileObj.relativePath,
      resumableTotalChunks: this.fileObj.chunks.length,
    };

    const targetUrl = getTargetURI(this.resumableObj, {
      ...queryParams,
      ...(customQueryParameters || {}),
    });

    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }

    const fetchTimeout = this.getOpt("fetchTimeout");
    let hasTimedOut = false;
    const timeoutId =
      fetchTimeout > 0
        ? setTimeout(() => {
            hasTimedOut = true;
            this.abortController?.abort();
          }, fetchTimeout)
        : null;

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        headers: customHeaders,
        signal: this.abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });
      if (timeoutId != null) clearTimeout(timeoutId);
      this.tested = true;

      // Status 200: chunk already exists on server
      // Status 204: chunk does not exist on server, please upload
      if (response.ok && response.status !== 204) {
        this._message = await response.text();
        this.callback("success", this._message);
        this.markComplete = true;
        this.resumableObj.uploadNextChunk();
      } else {
        this.send();
      }
    } catch (error: any) {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (error.name === "AbortError" && !hasTimedOut) return;

      this.tested = true;
      this.send();
    }
  }

  // send() uploads the actual data in a POST call
  async send(): Promise<void> {
    if (this.getOpt("testChunks") && !this.tested) {
      this.test();
      return;
    }

    this.abortController = new AbortController();
    this._status = "uploading";
    this.pendingRetry = false;
    this.callback("progress");

    const standardQueryParameters: ResumableChunkRequestParams = {
      resumableChunkNumber: this.offset + 1,
      resumableChunkSize: this.getOpt("chunkSize"),
      resumableCurrentChunkSize: this.endByte - this.startByte,
      resumableTotalSize: this.fileObjSize,
      resumableType: this.fileObjType,
      resumableIdentifier: this.fileObj.uniqueIdentifier,
      resumableFilename: this.fileObj.fileName,
      resumableRelativePath: this.fileObj.relativePath,
      resumableTotalChunks: this.fileObj.chunks.length,
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
      formData.append("file", bytes, this.fileObj.fileName);
      data = formData;
    } else {
      // chunkFormat == base64
      const readPromise = new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(bytes);
      });

      const base64Data = await readPromise;
      formData.append("file", base64Data);
      data = formData;
    }

    const targetUrl = getTargetURI(this.resumableObj, queryParameters);
    const fetchTimeout = this.getOpt("fetchTimeout");
    let hasTimedOut = false;
    const timeoutId =
      fetchTimeout > 0
        ? setTimeout(() => {
            hasTimedOut = true;
            this.abortController?.abort();
          }, fetchTimeout)
        : null;

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: data,
        signal: this.abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
      });
      if (timeoutId != null) clearTimeout(timeoutId);

      if (response.ok) {
        this._status = "success";
        this._message = await response.text();
        this.callback("success", this._message);
        this.resumableObj.uploadNextChunk();
      } else if (
        this.getOpt("permanentErrors").includes(response.status) ||
        this.retries >= this.getOpt("maxChunkRetries")
      ) {
        this._status = "error";
        this._message = await response.text();
        this.callback("error", this._message);
        this.resumableObj.uploadNextChunk();
      } else {
        throw new Error(`Server responded with ${response.status}`);
      }
    } catch (error: any) {
      if (timeoutId != null) clearTimeout(timeoutId);
      if (error.name === "AbortError" && !hasTimedOut) {
        return;
      }

      this.callback("retry", hasTimedOut ? "Timeout" : error.message);
      this.abort();
      this.retries++;

      const retryInterval = this.getOpt("chunkRetryInterval");
      if (retryInterval != null) {
        this.pendingRetry = true;
        setTimeout(() => this.send(), retryInterval);
      } else {
        this.send();
      }
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._status = "pending";
  }

  status(): ResumableChunkState {
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

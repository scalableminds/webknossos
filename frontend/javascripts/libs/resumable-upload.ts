// Inspired by Resumable.js (https://github.com/23/resumable.js)

/**
 * Configuration options for the Resumable instance.
 */
export interface ConfigurationHash {
  /**
   * The size in bytes of each uploaded chunk of data. The last uploaded chunk will be at least this size and up to two the size. (Default: `1*1024*1024`)
   */
  chunkSize?: number;
  /**
   * Force all chunks to be less or equal than chunkSize. Otherwise, the last chunk will be greater than or equal to `chunkSize`. (Default: `false`)
   */
  forceChunkSize?: boolean;
  /**
   * Number of simultaneous uploads (Default: `3`)
   */
  simultaneousUploads?: number;
  /**
   * The name of the multipart request parameter to use for the file chunk (Default: `file`)
   */
  fileParameterName?: string;
  /**
   * The name of the chunk index (base-1) in the current upload POST parameter to use for the file chunk (Default: `resumableChunkNumber`)
   */
  chunkNumberParameterName?: string;
  /**
   * The name of the general chunk size POST parameter to use for the file chunk (Default: `resumableChunkSize`)
   */
  chunkSizeParameterName?: string;
  /**
   * The name of the current chunk size POST parameter to use for the file chunk (Default: `resumableCurrentChunkSize`)
   */
  currentChunkSizeParameterName?: string;
  /**
   * The name of the total file size number POST parameter to use for the file chunk (Default: `resumableTotalSize`)
   */
  totalSizeParameterName?: string;
  /**
   * The name of the file type POST parameter to use for the file chunk (Default: `resumableType`)
   */
  typeParameterName?: string;
  /**
   * The name of the unique identifier POST parameter to use for the file chunk (Default: `resumableIdentifier`)
   */
  identifierParameterName?: string;
  /**
   * The name of the original file name POST parameter to use for the file chunk (Default: `resumableFilename`)
   */
  fileNameParameterName?: string;
  /**
   * The name of the file's relative path POST parameter to use for the file chunk (Default: `resumableRelativePath`)
   */
  relativePathParameterName?: string;
  /**
   * The name of the total number of chunks POST parameter to use for the file chunk (Default: `resumableTotalChunks`)
   */
  totalChunksParameterName?: string;
  throttleProgressCallbacks?: number;
  /**
   * Extra parameters to include in the multipart request with data. This can be an object or a function. If a function, it will be passed a ResumableFile and a ResumableChunk object (Default: `{}`)
   */
  query?:
    | Record<string, any>
    | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, any>);
  /**
   * Extra headers to include in the multipart POST with data. This can be an `object` or a `function` that allows you to construct and return a value, based on supplied `file` (Default: `{}`)
   */
  headers?:
    | Record<string, string>
    | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, string>);
  /**
   * Optional function to process each chunk before testing & sending. Function is passed the chunk as parameter, and should call the `preprocessFinished` method on the chunk when finished. (Default: `null`)
   */
  preprocess?: ((chunk: ResumableChunk) => Promise<void> | void) | null;
  /**
   * Optional function to process each file before testing & sending the corresponding chunks. Function is passed the file as parameter, and should call the `preprocessFinished` method on the file when finished. (Default: `null`)
   */
  preprocessFile?: ((file: ResumableFile) => Promise<void> | void) | null;
  /**
   * Method to use when sending chunks to the server (`multipart` or `octet`) (Default: `multipart`)
   */
  method?: "multipart" | "octet";
  /**
   * HTTP method to use when sending chunks to the server (`POST`, `PUT`, `PATCH`) (Default: `POST`)
   */
  uploadMethod?: string;
  /**
   * Method for chunk test request. (Default: `'GET'`)
   */
  testMethod?: string;
  /**
   * Prioritize first and last chunks of all files. This can be handy if you can determine if a file is valid for your service from only the first or last chunk. For example, photo or video meta data is usually located in the first part of a file, making it easy to test support from only the first chunk. (Default: `false`)
   */
  prioritizeFirstAndLastChunk?: boolean;
  /**
   * The target URL for the multipart POST request. This can be a `string` or a `function` that allows you you to construct and return a value, based on supplied `params`. (Default: `/`)
   */
  target?: string | ((params?: any) => string);
  /**
   * The target URL for the GET request to the server for each chunk to see if it already exists. This can be a `string` or a `function` that allows you you to construct and return a value, based on supplied `params`. (Default: `null`)
   */
  testTarget?: string | null;
  /**
   * Make a GET request to the server for each chunks to see if it already exists. If implemented on the server-side, this will allow for upload resumes even after a browser crash or even a computer restart. (Default: `true`)
   */
  testChunks?: boolean;
  /**
   * Override the function that generates unique identifiers for each file.
   */
  generateUniqueIdentifier?: ((file: File, event?: Event) => string | Promise<string>) | null;
  getTarget?: ((request: string, params: any) => string) | null;
  /**
   * The maximum number of retries for a chunk before the upload is failed. Valid values are any positive integer and `undefined` for no limit. (Default: `undefined`)
   */
  maxChunkRetries?: number;
  /**
   * The number of milliseconds to wait before retrying a chunk on a non-permanent error. Valid values are any positive integer and `undefined` for immediate retry. (Default: `undefined`)
   */
  chunkRetryInterval?: number | null;
  /**
   * List of HTTP status codes that define if the chunk upload was a permanent error and should not retry the upload. (Default: `[400, 404, 409, 415, 500, 501]`)
   */
  permanentErrors?: number[];
  /**
   * Indicates how many files can be uploaded in a single session. Valid values are any positive integer and `undefined` for no limit. (Default: `undefined`)
   */
  maxFiles?: number;
  /**
   * Standard CORS requests do not send or set any cookies by default. In order to include cookies as part of the request, you need to set the `withCredentials` property to true. (Default: `false`)
   */
  withCredentials?: boolean;
  /**
   * The timeout in milliseconds for each request (Default: `0`)
   */
  fetchTimeout?: number;
  clearInput?: boolean;
  chunkFormat?: "blob" | "base64";
  /**
   * Set chunk content-type from original file.type. (Default: `false`, if `false` default Content-Type: `application/octet-stream`)
   */
  setChunkTypeFromFile?: boolean;
  /**
   * A function which displays the *please upload n file(s) at a time* message. (Default: displays an alert box with the message *Please n one file(s) at a time.*)
   */
  maxFilesErrorCallback?: (files: File[], errorCount: number) => void;
  /**
   * The minimum allowed file size. (Default: 1)
   */
  minFileSize?: number;
  /**
   * A function which displays an error a selected file is smaller than allowed. (Default: displays an alert for every bad file.)
   */
  minFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  /**
   * The maximum allowed file size. (Default: `undefined`)
   */
  maxFileSize?: number;
  /**
   * A function which displays an error a selected file is larger than allowed. (Default: displays an alert for every bad file.)
   */
  maxFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  /**
   * The file types allowed to upload. An empty array allow any file type. (Default: `[]`)
   */
  fileType?: string[];
  /**
   * A function which displays an error a selected file has type not allowed. (Default: displays an alert for every bad file.)
   */
  fileTypeErrorCallback?: (file: File, errorCount: number) => void;
}

interface ExtendedFile extends File {
  relativePath?: string;
  uniqueIdentifier?: string;
}

export interface ResumableEventDetail {
  file?: ResumableFile;
  message?: string;
  error?: any;
  event?: Event;
  files?: ResumableFile[];
  skippedFiles?: File[];
}

export class ResumableUploadErrorEvent extends CustomEvent<ResumableEventDetail> {}

// Helper functions
const helpers = {
  stopEvent(e: Event): void {
    e.stopPropagation();
    e.preventDefault();
  },

  generateUniqueIdentifier(file: File, _event?: Event): string {
    const relativePath =
      (file as any).webkitRelativePath || (file as any).relativePath || file.name;
    const size = file.size;

    return size + "-" + relativePath.replace(/[^0-9a-zA-Z_-]/gim, "");
  },

  formatSize(size: number | undefined): string {
    if (size === undefined) {
      return "n/a";
    }
    if (size < 1024) {
      return size + " bytes";
    } else if (size < 1024 * 1024) {
      return (size / 1024.0).toFixed(0) + " KB";
    } else if (size < 1024 * 1024 * 1024) {
      return (size / 1024.0 / 1024.0).toFixed(1) + " MB";
    } else {
      return (size / 1024.0 / 1024.0 / 1024.0).toFixed(1) + " GB";
    }
  },

  getTargetURI(resumable: Resumable, request: string, params: Record<string, any>): string {
    let target = resumable.getOpt("target");
    const testTarget = resumable.getOpt("testTarget");

    if (request === "test" && testTarget !== null) {
      target = testTarget === "/" ? resumable.getOpt("target") : testTarget;
    }

    if (typeof target === "function") {
      return target(params);
    }

    const url = new URL(target as string, window.location.origin);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    return url.pathname + url.search;
  },
};

/**
 * Represents a single chunk of a file to be uploaded.
 * @param preprocessState 0 = unprocessed, 1 = processing, 2 = finished
 */
export class ResumableChunk {
  opts: Partial<ConfigurationHash> = {};
  resumableObj: Resumable;
  fileObj: ResumableFile;
  fileObjSize: number;
  fileObjType: string;
  offset: number;
  callback: (event: "progress" | "success" | "error" | "retry", message?: string) => void;
  lastProgressCallback: Date;
  tested = false;
  retries = 0;
  pendingRetry = false;
  preprocessState: 0 | 1 | 2 = 0; // 0 = unprocessed, 1 = processing, 2 = finished
  markComplete = false;
  startByte: number;
  endByte: number;

  private abortController: AbortController | null = null;
  private _status: "pending" | "uploading" | "success" | "error" = "pending";
  private _message: string = "";

  constructor(
    resumableObj: Resumable,
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

    const params: Record<string, any> = {};
    let customQueryParameters = this.getOpt("query");

    if (typeof customQueryParameters === "function") {
      customQueryParameters = customQueryParameters(this.fileObj, this);
    }

    Object.assign(params, customQueryParameters || {});

    const extraParams: Partial<Record<keyof ConfigurationHash, any>> = {
      chunkNumberParameterName: this.offset + 1,
      chunkSizeParameterName: this.getOpt("chunkSize"),
      currentChunkSizeParameterName: this.endByte - this.startByte,
      totalSizeParameterName: this.fileObjSize,
      typeParameterName: this.fileObjType,
      identifierParameterName: this.fileObj.uniqueIdentifier,
      fileNameParameterName: this.fileObj.fileName,
      relativePathParameterName: this.fileObj.relativePath,
      totalChunksParameterName: this.fileObj.chunks.length,
    };

    const targetUrl = helpers.getTargetURI(this.resumableObj, "test", extraParams);

    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }

    try {
      const response = await fetch(targetUrl, {
        method: this.getOpt("testMethod") as string,
        headers: customHeaders,
        signal: this.abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
        // TODO: add timeout
      });

      this.tested = true;

      if (response.ok) {
        this._message = await response.text();
        this.callback("success", this._message);
        this.markComplete = true; // Tom added this.
        this.resumableObj.uploadNextChunk();
      } else {
        this.send();
      }
    } catch (error: any) {
      if (error.name === "AbortError") return;
      this.send();
    }
  }

  preprocessFinished(): void {
    this.preprocessState = 2;
    this.send();
  }

  // send() uploads the actual data in a POST call
  async send(): Promise<void> {
    const preprocess = this.getOpt("preprocess");
    if (typeof preprocess === "function") {
      switch (this.preprocessState) {
        case 0:
          this.preprocessState = 1;
          await Promise.resolve(preprocess(this));
          return;
        case 1:
          return;
        case 2:
          break;
      }
    }

    if (this.getOpt("testChunks") && !this.tested) {
      this.test();
      return;
    }

    this.abortController = new AbortController();
    this._status = "uploading";
    this.pendingRetry = false;
    this.callback("progress");

    const queryParameters: Partial<Record<keyof ConfigurationHash, any>> = {
      chunkNumberParameterName: this.offset + 1,
      chunkSizeParameterName: this.getOpt("chunkSize"),
      currentChunkSizeParameterName: this.endByte - this.startByte,
      totalSizeParameterName: this.fileObjSize,
      typeParameterName: this.fileObjType,
      identifierParameterName: this.fileObj.uniqueIdentifier,
      fileNameParameterName: this.fileObj.fileName,
      relativePathParameterName: this.fileObj.relativePath,
      totalChunksParameterName: this.fileObj.chunks.length,
    };

    let customQueryParameters = this.getOpt("query");
    if (typeof customQueryParameters === "function") {
      customQueryParameters = customQueryParameters(this.fileObj, this);
    }
    Object.assign(queryParameters, customQueryParameters || {});

    const bytes = this.fileObj.file.slice(
      this.startByte,
      this.endByte,
      this.getOpt("setChunkTypeFromFile") ? this.fileObj.file.type : "",
    );

    let data: FormData | Blob | string;

    const headers: Record<string, string> = {};
    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }
    Object.assign(headers, customHeaders);

    if (this.getOpt("method") === "octet") {
      data = bytes;
      headers["Content-Type"] = "application/octet-stream";
    } else {
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
        formData.append(this.getOpt("fileParameterName"), base64Data);
        data = formData;
      }
    }

    const targetUrl = helpers.getTargetURI(this.resumableObj, "upload", queryParameters);

    try {
      const response = await fetch(targetUrl, {
        method: this.getOpt("uploadMethod") as string,
        headers,
        body: data,
        signal: this.abortController.signal,
        credentials: this.getOpt("withCredentials") ? "include" : "same-origin",
        // TODO: add timeout
      });

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
      if (error.name === "AbortError") {
        this._status = "pending";
        return;
      }

      this.callback("retry", error.message);
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
    if ((!this.abortController || !this.abortController.signal.aborted) && !this.markComplete)
      factor *= 0.95; // TODO: is this really necessary?

    const s = this.status();
    switch (s) {
      case "success":
      case "error":
        return 1 * factor;
      case "pending":
        return 0 * factor;
      default:
        return 0 * factor;
    }
  }
}

/**
 * Represents a file to be uploaded.
 */
export class ResumableFile {
  opts: Partial<ConfigurationHash> = {};
  /**
   * A back-reference to the parent `Resumable` object.
   */
  resumableObj: Resumable;
  /**
   * The correlating HTML5 `File` object.
   */
  file: File;
  /**
   * The name of the file.
   */
  fileName: string;
  /**
   * Size in bytes of the file.
   */
  size: number;
  /**
   * The relative path to the file (defaults to file name if relative path doesn't exist)
   */
  relativePath: string;
  /**
   * A unique identifier assigned to this file object. This value is included in uploads to the server for reference, but can also be used in CSS classes etc when building your upload UI.
   */
  uniqueIdentifier: string;
  /**
   * An array of `ResumableChunk` items.
   */
  chunks: ResumableChunk[] = [];
  container: EventTarget | null = null;
  preprocessState: 0 | 1 | 2 = 0; // 0 = unprocessed, 1 = processing, 2 = finished
  private _prevProgress = 0;
  private _pause = false;
  private _error: boolean;

  constructor(resumableObj: Resumable, file: File, uniqueIdentifier: string) {
    this.resumableObj = resumableObj;
    this.file = file;
    this.fileName = file.name;
    this.size = file.size;
    this.relativePath =
      (file as any).relativePath || (file as any).webkitRelativePath || this.fileName;
    this.uniqueIdentifier = uniqueIdentifier;
    this._error = uniqueIdentifier === undefined;

    this.resumableObj.dispatch("chunkingStart", { file: this });
    this.bootstrap();
  }

  getOpt<T extends keyof ConfigurationHash>(key: T): Required<ConfigurationHash>[T] {
    if (this.opts[key] !== undefined) {
      return this.opts[key] as Required<ConfigurationHash>[T];
    }
    return this.resumableObj.getOpt(key);
  }

  // Callback when something happens within the chunk
  private chunkEvent(event: "progress" | "success" | "error" | "retry", message?: string): void {
    switch (event) {
      case "progress":
        this.resumableObj.dispatch("fileProgress", { file: this, message });
        break;
      case "error":
        this.abort();
        this._error = true;
        this.chunks = [];
        this.resumableObj.dispatch("fileError", { file: this, message });
        break;
      case "success":
        if (this._error) return;
        this.resumableObj.dispatch("fileProgress", { file: this, message });
        if (this.isComplete()) {
          this.resumableObj.dispatch("fileSuccess", { file: this, message });
        }
        break;
      case "retry":
        this.resumableObj.dispatch("fileRetry", { file: this });
        break;
    }
  }

  /**
   * Abort uploading the file.
   */
  abort(): void {
    let abortCount = 0;
    for (const chunk of this.chunks) {
      if (chunk.status() === "uploading") {
        chunk.abort();
        abortCount++;
      }
    }
    if (abortCount > 0) {
      this.resumableObj.dispatch("fileProgress", { file: this });
    }
  }

  /**
   * Abort uploading the file and delete it from the list of files to upload (reset).
   */
  cancel(): void {
    const chunks = this.chunks;
    this.chunks = [];
    for (const chunk of chunks) {
      if (chunk.status() === "uploading") {
        chunk.abort();
        this.resumableObj.uploadNextChunk();
      }
    }
    this.resumableObj.removeFile(this);
    this.resumableObj.dispatch("fileProgress", { file: this });
  }

  /**
   * Retry uploading the file.
   */
  retry(): void {
    this.bootstrap();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.file === this) {
        this.resumableObj.upload();
        this.resumableObj.removeEventListener("chunkingComplete", handler);
      }
    };
    this.resumableObj.addEventListener("chunkingComplete", handler);
  }

  /**
   * Rebuild the state of a `ResumableFile` object, including reassigning chunks and XMLHttpRequest instances.
   */
  bootstrap(): void {
    this.abort();
    this._error = false;
    this.chunks = [];
    this._prevProgress = 0;

    const round = this.getOpt("forceChunkSize") ? Math.ceil : Math.floor;
    const maxOffset = Math.max(round(this.file.size / this.getOpt("chunkSize")), 1);

    // Rebuild stack of chunks from file
    for (let offset = 0; offset < maxOffset; offset++) {
      this.chunks.push(
        new ResumableChunk(this.resumableObj, this, offset, (event, message) =>
          this.chunkEvent(event, message),
        ),
      );
      this.resumableObj.dispatch("chunkingProgress", {
        file: this,
        message: (offset / maxOffset).toString(),
      });
    }

    setTimeout(() => {
      this.resumableObj.dispatch("chunkingComplete", { file: this });
    }, 0);
  }

  /**
   * Returns a float between 0 and 1 indicating the current upload progress of the file. If `relative` is `true`, the value is returned relative to all files in the Resumable.js instance.
   */
  progress(): number {
    if (this._error) return 1;

    let returnValue = 0;
    let error = false;
    for (const chunk of this.chunks) {
      if (chunk.status() === "error") error = true;
      returnValue += chunk.progress(true); // get chunk progress relative to entire file
    }
    returnValue = error ? 1 : returnValue > 0.99999 ? 1 : returnValue;
    returnValue = Math.max(this._prevProgress, returnValue); // We don't want to lose percentages when an upload is paused
    this._prevProgress = returnValue;
    return returnValue;
  }

  /**
   * Returns a boolean indicating whether file chunks is uploading.
   */
  isUploading(): boolean {
    return this.chunks.some((chunk) => chunk.status() === "uploading");
  }

  /**
   * Returns a boolean indicating whether the file has completed uploading and received a server response.
   */
  isComplete(): boolean {
    if (this.preprocessState === 1) return false;

    return !this.chunks.some(
      (chunk) =>
        chunk.status() === "uploading" ||
        chunk.status() === "pending" ||
        chunk.preprocessState === 1,
    );
  }

  pause(pause?: boolean): void {
    this._pause = pause === undefined ? !this._pause : pause;
  }

  isPaused(): boolean {
    return this._pause;
  }

  preprocessFinished(): void {
    this.preprocessState = 2;
    this.upload();
  }

  upload(): boolean {
    if (this.isPaused() === false) {
      const preprocess = this.getOpt("preprocessFile");
      if (typeof preprocess === "function") {
        switch (this.preprocessState) {
          case 0: {
            this.preprocessState = 1;
            const result = preprocess(this);
            if (result instanceof Promise) result.catch(() => {});
            return true;
          }
          case 1:
            return true;
          case 2:
            break;
        }
      }

      for (const chunk of this.chunks) {
        if (chunk.status() === "pending" && chunk.preprocessState !== 1) {
          chunk.send();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * starts upload from the next chunk number while marking all previous chunks complete. Must be called before upload() method
   */
  markChunksCompleted(chunkNumber: number): void {
    if (!this.chunks || this.chunks.length <= chunkNumber) return;

    for (let num = 0; num < chunkNumber; num++) {
      if (this.chunks[num]) this.chunks[num].markComplete = true;
    }
  }
}

/**
 * Main class for managing resumable uploads.
 * Implements EventTarget via composition to ensure compatibility.
 */
export class Resumable implements EventTarget {
  /**
   * An array of `ResumableFile` file objects added by the user.
   */
  files: ResumableFile[] = [];
  defaults: Required<ConfigurationHash>;
  /**
   * A hash object of the configuration of the Resumable.js instance.
   */
  opts: Partial<ConfigurationHash>;
  version = 1.0;

  private _eventTarget: EventTarget;

  constructor(opts: Partial<ConfigurationHash> = {}) {
    this._eventTarget = new EventTarget();

    this.defaults = {
      chunkSize: 1 * 1024 * 1024,
      forceChunkSize: false,
      simultaneousUploads: 3,
      fileParameterName: "file",
      chunkNumberParameterName: "resumableChunkNumber",
      chunkSizeParameterName: "resumableChunkSize",
      currentChunkSizeParameterName: "resumableCurrentChunkSize",
      totalSizeParameterName: "resumableTotalSize",
      typeParameterName: "resumableType",
      identifierParameterName: "resumableIdentifier",
      fileNameParameterName: "resumableFilename",
      relativePathParameterName: "resumableRelativePath",
      totalChunksParameterName: "resumableTotalChunks",
      throttleProgressCallbacks: 0.5,
      query: {},
      headers: {},
      preprocess: null,
      preprocessFile: null,
      method: "multipart",
      uploadMethod: "POST",
      testMethod: "GET",
      prioritizeFirstAndLastChunk: false,
      target: "/",
      testTarget: null,

      testChunks: true,
      generateUniqueIdentifier: null,
      getTarget: null,
      maxChunkRetries: 100,
      chunkRetryInterval: null,
      permanentErrors: [400, 401, 403, 404, 409, 415, 500, 501],
      maxFiles: Number.POSITIVE_INFINITY,
      withCredentials: false,
      fetchTimeout: 0,
      clearInput: true,
      chunkFormat: "blob",
      setChunkTypeFromFile: false,
      maxFilesErrorCallback: () => {
        const maxFiles = this.getOpt("maxFiles");
        console.error(
          `Please upload no more than ${maxFiles} file${maxFiles === 1 ? "" : "s"} at a time.`,
        );
      },
      minFileSize: 1,
      minFileSizeErrorCallback: (file: File) => {
        console.error(
          `${file.name} is too small, please upload files larger than ${helpers.formatSize(this.getOpt("minFileSize"))}.`,
        );
      },
      maxFileSize: Number.POSITIVE_INFINITY,
      maxFileSizeErrorCallback: (file: File) => {
        console.error(
          `${file.name} is too large, please upload files less than ${helpers.formatSize(this.getOpt("maxFileSize"))}.`,
        );
      },
      fileType: [],
      fileTypeErrorCallback: (file: File) => {
        console.error(
          `${file.name} has type not allowed, please upload files of type ${this.getOpt("fileType")}.`,
        );
      },
    };

    this.opts = opts;
  }

  /**
   * Listen for event from Resumable
   */
  addEventListener<K extends Event = Event>(
    type: string,
    callback: ((event: K) => void) | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this._eventTarget.addEventListener(
      type,
      callback as EventListenerOrEventListenerObject | null,
      options,
    );
  }

  dispatchEvent(event: Event): boolean {
    return this._eventTarget.dispatchEvent(event);
  }

  removeEventListener(
    type: string,
    callback: EventListener | null,
    options?: boolean | EventListenerOptions | undefined,
  ): void {
    this._eventTarget.removeEventListener(type, callback, options);
  }

  getOpts<T extends keyof ConfigurationHash>(
    options: T[],
  ): { [K in T]: ReturnType<typeof this.getOpt<K>> } {
    return options.reduce(
      (acc, opt) => {
        acc[opt] = this.getOpt(opt);
        return acc;
      },
      {} as { [K in T]: ReturnType<typeof this.getOpt<K>> },
    );
  }

  getOpt<T extends keyof ConfigurationHash>(option: T): Required<ConfigurationHash>[T] {
    const value = this.opts[option];
    return (value !== undefined ? value : this.defaults[option]) as Required<ConfigurationHash>[T];
  }

  dispatch(event: string, detail: ResumableEventDetail = {}): void {
    const e =
      event === "error"
        ? new ResumableUploadErrorEvent(event, { detail })
        : new CustomEvent(event, { detail });

    this.dispatchEvent(e);

    if (event === "fileError") {
      this.dispatch("error", { error: detail.message, file: detail.file });
    }
    if (event === "fileProgress") {
      this.dispatch("progress");
    }
  }
  /**
   * processes a single upload item (file or directory)
   * @param item item to upload, may be file or directory entry
   * @param path current file path
   * @param items list of files to append new items to
   * @param callback callback invoked when item is processed
   */
  private processItem(item: any, path: string, items: ExtendedFile[], callback: () => void): void {
    let entry: any;
    if (item.isFile) {
      item.file((file: File) => {
        (file as ExtendedFile).relativePath = path + file.name;
        items.push(file as ExtendedFile);
        callback();
      });
      return;
    } else if (item.isDirectory) {
      entry = item;
    } else if (item instanceof File) {
      items.push(item);
    }
    if (typeof item.webkitGetAsEntry === "function") {
      entry = item.webkitGetAsEntry();
    }
    if (entry?.isDirectory) {
      // directory provided, process it
      this.processDirectory(entry, path + entry.name + "/", items, callback);
      return;
    }
    if (typeof item.getAsFile === "function") {
      // item represents a File object, convert it
      item = item.getAsFile();
      if (item instanceof File) {
        (item as ExtendedFile).relativePath = path + item.name;
        items.push(item);
      }
    }
    callback(); // indicate processing is done
  }

  /**
   * cps-style list iteration.
   * invokes all functions in list and waits for their callback to be
   * triggered.
   * @param items list of functions expecting callback parameter
   * @param callback callback to trigger after the last callback has been invoked
   */
  private processCallbacks(
    items: Array<(callback: () => void) => void>,
    callback: () => void,
  ): void {
    if (!items || items.length === 0) {
      // empty or no list, invoke callback
      callback();
      return;
    }
    // invoke current function, pass the next part as continuation
    items[0](() => {
      this.processCallbacks(items.slice(1), callback);
    });
  }

  /**
   * recursively traverse directory and collect files to upload
   * @param directory directory to process
   * @param path current path
   * @param items target list of items
   * @param callback callback invoked after traversing directory
   */
  private processDirectory(
    directory: any,
    path: string,
    items: ExtendedFile[],
    callback: () => void,
  ): void {
    const dirReader = directory.createReader();
    const allEntries: any[] = [];
    const readEntries = (): void => {
      dirReader.readEntries((entries: any[]) => {
        if (entries.length) {
          allEntries.push(...entries);
          return readEntries();
        }

        // process all conversion callbacks, finally invoke own one
        this.processCallbacks(
          allEntries.map((entry) => this.processItem.bind(this, entry, path, items)),
          callback,
        );
      });
    };

    readEntries();
  }

  /**
   * append files from a file list
   * @param fileList list of files to append
   * @param event event that triggered the file append
   */
  private appendFilesFromFileList(fileList: File[], event: Event): void {
    // check for uploading too many files
    let errorCount = 0;
    const options = this.getOpts([
      "maxFiles",
      "minFileSize",
      "maxFileSize",
      "maxFilesErrorCallback",
      "minFileSizeErrorCallback",
      "maxFileSizeErrorCallback",
      "fileType",
      "fileTypeErrorCallback",
    ]);

    if ((options.maxFiles as number) < fileList.length + this.files.length) {
      if (options.maxFiles === 1 && this.files.length === 1 && fileList.length === 1) {
        this.removeFile(this.files[0]);
      } else {
        (options.maxFilesErrorCallback as (files: File[], errorCount: number) => void)(
          fileList,
          errorCount++,
        );
        return;
      }
    }

    const files: ResumableFile[] = [];
    const filesSkipped: File[] = [];
    let remaining = fileList.length;

    const decreaseRemaining = (): void => {
      if (!--remaining) {
        // all files processed, trigger event
        if (!files.length && !filesSkipped.length)
          // no succeeded files, just skip
          return;
        setTimeout(() => {
          this.dispatch("filesAdded", { files: files, skippedFiles: filesSkipped });
        }, 0);
      }
    };

    for (const file of fileList) {
      const fileName = file.name;
      const fileType = file.type;

      if (options.fileType.length > 0) {
        let fileTypeFound = false;
        for (const index in options.fileType) {
          // For good behaviour we do some inital sanitizing. Remove spaces and lowercase all
          const typeDef = options.fileType[index].replace(/\s/g, "").toLowerCase();
          // Allowing for both [extension, .extension, mime/type, mime/*]
          let extension = typeDef.match(/^[^.][^/]+$/) ? "." + typeDef : typeDef;

          if (
            fileName.substr(-1 * extension.length).toLowerCase() === extension ||
            //If MIME type, check for wildcard or if extension matches the files tiletype
            (extension.indexOf("/") !== -1 &&
              ((extension.indexOf("*") !== -1 &&
                fileType.substr(0, extension.indexOf("*")) ===
                  extension.substr(0, extension.indexOf("*"))) ||
                fileType === extension))
          ) {
            fileTypeFound = true;
            break;
          }
        }
        if (!fileTypeFound) {
          options.fileTypeErrorCallback(file, errorCount++);
          continue;
        }
      }

      if (file.size < (options.minFileSize as number)) {
        (options.minFileSizeErrorCallback as (file: File, errorCount: number) => void)(
          file,
          errorCount++,
        );
        continue;
      }
      if (file.size > (options.maxFileSize as number)) {
        (options.maxFileSizeErrorCallback as (file: File, errorCount: number) => void)(
          file,
          errorCount++,
        );
        continue;
      }

      const addFile = (uniqueIdentifier: string): void => {
        if (!this.getFromUniqueIdentifier(uniqueIdentifier)) {
          (file as ExtendedFile).uniqueIdentifier = uniqueIdentifier;
          const f = new ResumableFile(this, file, uniqueIdentifier);
          this.files.push(f);
          files.push(f);
          f.container = typeof event !== "undefined" ? event.target : null;
          setTimeout(() => {
            this.dispatch("fileAdded", { file: f, event });
          }, 0);
        } else {
          filesSkipped.push(file);
        }
        decreaseRemaining();
      };

      // directories have size == 0
      const uniqueIdentifier = helpers.generateUniqueIdentifier(file, event);
      const customGenerator = this.getOpt("generateUniqueIdentifier");

      if (typeof customGenerator === "function") {
        const result = customGenerator(file, event);
        if (result && typeof (result as any).then === "function") {
          // Promise or Promise-like object provided as unique identifier
          (result as Promise<string>).then(addFile).catch(decreaseRemaining);
        } else {
          // non-Promise provided as unique identifier, process synchronously
          addFile(result as string);
        }
      } else {
        addFile(uniqueIdentifier);
      }
    }
  }

  uploadNextChunk(): boolean {
    let found = false;

    // In some cases (such as videos) it's really handy to upload the first
    // and last chunk of a file quickly; this let's the server check the file's
    // metadata and determine if there's even a point in continuing.
    if (this.getOpt("prioritizeFirstAndLastChunk")) {
      for (const file of this.files) {
        if (
          file.chunks.length &&
          file.chunks[0].status() === "pending" &&
          file.chunks[0].preprocessState === 0
        ) {
          file.chunks[0].send();
          return true;
        }
        if (
          file.chunks.length > 1 &&
          file.chunks[file.chunks.length - 1].status() === "pending" &&
          file.chunks[file.chunks.length - 1].preprocessState === 0
        ) {
          file.chunks[file.chunks.length - 1].send();
          return true;
        }
      }
    }

    // Now, simply look for the next, best thing to upload
    for (const file of this.files) {
      found = file.upload();
      if (found) return true;
    }

    // The are no more outstanding chunks to upload, check is everything is done
    const outstanding = this.files.some((file) => !file.isComplete());
    if (!outstanding) this.dispatch("complete");

    return false;
  }

  /**
   * Returns a boolean indicating whether or not the instance is currently uploading anything.
   */
  isUploading(): boolean {
    return this.files.some((file) => file.isUploading());
  }

  /**
   * Start or resume uploading.
   */
  upload(): void {
    // Make sure we don't start too many uploads at once
    if (this.isUploading()) return;

    // Kick off the queue
    this.dispatch("uploadStart");
    for (let num = 1; num <= (this.getOpt("simultaneousUploads") as number); num++) {
      this.uploadNextChunk();
    }
  }

  /**
   * Pause uploading.
   */
  pause(): void {
    for (const file of this.files) file.abort();
    this.dispatch("pause");
  }

  /**
   * Cancel upload of all `ResumableFile` objects and remove them from the list.
   */
  cancel(): void {
    this.dispatch("beforeCancel");
    for (let i = this.files.length - 1; i >= 0; i--) this.files[i].cancel();
    this.dispatch("cancel");
  }

  /**
   * Returns a float between 0 and 1 indicating the current upload progress of all files.
   */
  progress(): number {
    let totalDone = 0;
    let totalSize = 0;
    for (const file of this.files) {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    }
    return totalSize > 0 ? totalDone / totalSize : 0;
  }

  /**
   * Add a HTML5 File object to the list of files.
   */
  addFile(file: File, event?: Event): void {
    this.dispatch("beforeAdd");
    this.appendFilesFromFileList([file], event || new Event("addFile"));
  }

  /**
   * Add an Array of HTML5 File objects to the list of files.
   */
  addFiles(files: File[], event?: Event): void {
    this.dispatch("beforeAdd");
    this.appendFilesFromFileList(files, event || new Event("addFiles"));
  }

  /**
   * Remove a specific `ResumableFile` object from the list.
   */
  removeFile(file: ResumableFile): void {
    for (let i = this.files.length - 1; i >= 0; i--) {
      if (this.files[i] === file) this.files.splice(i, 1);
    }
  }

  /**
   * Look up a `ResumableFile` object by its unique identifier.
   */
  getFromUniqueIdentifier(uniqueIdentifier: string): ResumableFile | false {
    return this.files.find((file) => file.uniqueIdentifier === uniqueIdentifier) || false;
  }

  /**
   * Returns the total size of the upload in bytes.
   */
  getSize(): number {
    let totalSize = 0;
    for (const file of this.files) totalSize += file.size;
    return totalSize;
  }

  updateQuery(query: Record<string, any>): void {
    this.opts.query = query;
  }
}

export default Resumable;

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
  /**
   * The class name to add on drag over an assigned drop zone. (Default: `dragover`)
   */
  dragOverClass?: string;
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
   * Extra prefix added before the name of each parameter included in the multipart POST or in the test GET. (Default: `''`)
   */
  parameterNamespace?: string;
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
  chunkRetryInterval?: number;
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
   * The minimum allowed file size. (Default: `undefined`)
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

interface ResumableEventDetail {
  file?: ResumableFile;
  message?: string;
  error?: any;
  event?: Event;
  files?: ResumableFile[];
  skippedFiles?: File[];
}

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

  formatSize(size: number): string {
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

  getTarget(resumable: Resumable, request: string, params: string[]): string {
    let target = resumable.getOpt("target");

    if (request === "test" && resumable.getOpt("testTarget")) {
      target =
        resumable.getOpt("testTarget") === "/"
          ? resumable.getOpt("target")
          : resumable.getOpt("testTarget");
    }

    if (typeof target === "function") {
      return target(params);
    }

    const separator = (target as string).indexOf("?") < 0 ? "?" : "&";
    const joinedParams = params.join("&");

    if (joinedParams) {
      target = target + separator + joinedParams;
    }

    return target as string;
  },
};

/**
 * Represents a single chunk of a file to be uploaded.
 */
export class ResumableChunk {
  opts: Partial<ConfigurationHash> = {};
  resumableObj: Resumable;
  fileObj: ResumableFile;
  fileObjSize: number;
  fileObjType: string;
  offset: number;
  callback: (event: string, message?: string) => void;
  lastProgressCallback: Date;
  tested = false;
  retries = 0;
  pendingRetry = false;
  preprocessState: 0 | 1 | 2 = 0;
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
    callback: (event: string, message?: string) => void,
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

  getOpt(key: keyof ConfigurationHash): any {
    if (typeof this.opts[key] !== "undefined") {
      return this.opts[key];
    }
    return this.fileObj.getOpt(key);
  }

  async test(): Promise<void> {
    this.abortController = new AbortController();

    const params: string[] = [];
    const parameterNamespace = this.getOpt("parameterNamespace") as string;
    let customQuery = this.getOpt("query");

    if (typeof customQuery === "function") {
      customQuery = customQuery(this.fileObj, this);
    }

    Object.entries((customQuery as Record<string, any>) || {}).forEach(([k, v]) => {
      params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join("="));
    });

    const extraParams: Array<[keyof ConfigurationHash, any]> = [
      ["chunkNumberParameterName", this.offset + 1],
      ["chunkSizeParameterName", this.getOpt("chunkSize")],
      ["currentChunkSizeParameterName", this.endByte - this.startByte],
      ["totalSizeParameterName", this.fileObjSize],
      ["typeParameterName", this.fileObjType],
      ["identifierParameterName", this.fileObj.uniqueIdentifier],
      ["fileNameParameterName", this.fileObj.fileName],
      ["relativePathParameterName", this.fileObj.relativePath],
      ["totalChunksParameterName", this.fileObj.chunks.length],
    ];

    params.push(
      ...extraParams
        .filter((pair) => this.getOpt(pair[0]))
        .map((pair) =>
          [parameterNamespace + (this.getOpt(pair[0]) as string), encodeURIComponent(pair[1])].join(
            "=",
          ),
        ),
    );

    const targetUrl = helpers.getTarget(this.resumableObj, "test", params);

    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }

    try {
      const response = await fetch(targetUrl, {
        method: this.getOpt("testMethod") as string,
        headers: customHeaders as Record<string, string>,
        signal: this.abortController.signal,
      });

      this.tested = true;

      if (response.ok || response.status === 200) {
        this._message = await response.text();
        this.callback("success", this._message);
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

    const queryBase: Record<string, any> = [
      ["chunkNumberParameterName", this.offset + 1],
      ["chunkSizeParameterName", this.getOpt("chunkSize")],
      ["currentChunkSizeParameterName", this.endByte - this.startByte],
      ["totalSizeParameterName", this.fileObjSize],
      ["typeParameterName", this.fileObjType],
      ["identifierParameterName", this.fileObj.uniqueIdentifier],
      ["fileNameParameterName", this.fileObj.fileName],
      ["relativePathParameterName", this.fileObj.relativePath],
      ["totalChunksParameterName", this.fileObj.chunks.length],
    ]
      .filter((pair) => this.getOpt(pair[0] as keyof ConfigurationHash))
      .reduce(
        (query, pair) => {
          query[this.getOpt(pair[0] as keyof ConfigurationHash) as string] = pair[1];
          return query;
        },
        {} as Record<string, any>,
      );

    let customQuery = this.getOpt("query");
    if (typeof customQuery === "function") {
      customQuery = customQuery(this.fileObj, this);
    }
    Object.assign(queryBase, customQuery || {});

    const bytes = this.fileObj.file.slice(
      this.startByte,
      this.endByte,
      this.getOpt("setChunkTypeFromFile") ? this.fileObj.file.type : "",
    );

    let body: FormData | Blob | string;
    const params: string[] = [];
    const parameterNamespace = this.getOpt("parameterNamespace") as string;

    const headers: Record<string, string> = {};
    let customHeaders = this.getOpt("headers");
    if (typeof customHeaders === "function") {
      customHeaders = customHeaders(this.fileObj, this);
    }
    Object.assign(headers, customHeaders);

    if (this.getOpt("method") === "octet") {
      body = bytes;
      headers["Content-Type"] = "application/octet-stream";
      Object.entries(queryBase).forEach(([k, v]) => {
        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join("="));
      });
    } else {
      const formData = new FormData();
      Object.entries(queryBase).forEach(([k, v]) => {
        formData.append(parameterNamespace + k, v);
        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join("="));
      });

      if (this.getOpt("chunkFormat") === "blob") {
        formData.append(
          parameterNamespace + (this.getOpt("fileParameterName") as string),
          bytes,
          this.fileObj.fileName,
        );
        body = formData;
      } else {
        const readPromise = new Promise<string>((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.readAsDataURL(bytes);
        });
        const base64Data = await readPromise;
        formData.append(
          parameterNamespace + (this.getOpt("fileParameterName") as string),
          base64Data,
        );
        body = formData;
      }
    }

    const targetUrl = helpers.getTarget(this.resumableObj, "upload", params);

    try {
      const response = await fetch(targetUrl, {
        method: this.getOpt("uploadMethod") as string,
        headers,
        body,
        signal: this.abortController.signal,
      });

      if (response.ok || response.status === 201) {
        this._status = "success";
        this._message = await response.text();
        this.callback("success", this._message);
        this.resumableObj.uploadNextChunk();
      } else if (
        (this.getOpt("permanentErrors") as number[]).includes(response.status) ||
        this.retries >= (this.getOpt("maxChunkRetries") as number)
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
      if (retryInterval !== undefined) {
        this.pendingRetry = true;
        setTimeout(() => this.send(), retryInterval as number);
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
    if (this.pendingRetry) return "uploading";
    if (this.markComplete) return "success";
    return this._status;
  }

  message(): string {
    return this._message;
  }

  progress(relative = false): number {
    const factor = relative ? (this.endByte - this.startByte) / this.fileObjSize : 1;
    if (this.pendingRetry) return 0;
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
  preprocessState: 0 | 1 | 2 = 0;
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

  getOpt(key: keyof ConfigurationHash): any {
    if (typeof this.opts[key] !== "undefined") {
      return this.opts[key];
    }
    return this.resumableObj.getOpt(key);
  }

  private chunkEvent(event: string, message?: string): void {
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
    for (const c of this.chunks) {
      if (c.status() === "uploading") {
        c.abort();
        abortCount++;
      }
    }
    if (abortCount > 0) {
      this.resumableObj.dispatch("fileProgress", { file: this });
    }
  }

  /**
   * Abort uploading the file and delete it from the list of files to upload.
   */
  cancel(): void {
    const chunks = this.chunks;
    this.chunks = [];
    for (const c of chunks) {
      if (c.status() === "uploading") {
        c.abort();
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
    const maxOffset = Math.max(round(this.file.size / (this.getOpt("chunkSize") as number)), 1);

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
    for (const c of this.chunks) {
      if (c.status() === "error") error = true;
      returnValue += c.progress(true);
    }
    returnValue = error ? 1 : returnValue > 0.99999 ? 1 : returnValue;
    returnValue = Math.max(this._prevProgress, returnValue);
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
    let outstanding = false;
    for (const chunk of this.chunks) {
      const status = chunk.status();
      if (status === "pending" || status === "uploading" || chunk.preprocessState === 1) {
        outstanding = true;
        break;
      }
    }
    return !outstanding;
  }

  pause(pause?: boolean): void {
    this._pause = typeof pause === "undefined" ? !this._pause : pause;
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
      dragOverClass: "dragover",
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
      parameterNamespace: "",
      testChunks: true,
      generateUniqueIdentifier: null,
      getTarget: null,
      maxChunkRetries: 100,
      chunkRetryInterval: undefined,
      permanentErrors: [400, 401, 403, 404, 409, 415, 500, 501],
      maxFiles: undefined,
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
          `${file.name} is too small, please upload files larger than ${helpers.formatSize(this.getOpt("minFileSize") as number)}.`,
        );
      },
      maxFileSize: undefined,
      maxFileSizeErrorCallback: (file: File) => {
        console.error(
          `${file.name} is too large, please upload files less than ${helpers.formatSize(this.getOpt("maxFileSize") as number)}.`,
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
  addEventListener(
    type: string,
    callback: EventListener | null,
    options?: boolean | AddEventListenerOptions | undefined,
  ): void {
    this._eventTarget.addEventListener(type, callback, options);
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

  getOpt(o: keyof ConfigurationHash | (keyof ConfigurationHash)[]): any {
    if (Array.isArray(o)) {
      const options: Partial<ConfigurationHash> = {};
      o.forEach((option) => {
        options[option] = this.getOpt(option);
      });
      return options;
    }
    return typeof this.opts[o] !== "undefined" ? this.opts[o] : this.defaults[o];
  }

  dispatch(event: string, detail: ResumableEventDetail = {}): void {
    const e = new CustomEvent(event, { detail });
    this.dispatchEvent(e);
    if (event === "fileError") {
      this.dispatch("error", { error: detail.message, file: detail.file });
    }
    if (event === "fileProgress") {
      this.dispatch("progress");
    }
  }

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
      this.processDirectory(entry, path + entry.name + "/", items, callback);
      return;
    }
    if (typeof item.getAsFile === "function") {
      item = item.getAsFile();
      if (item instanceof File) {
        (item as ExtendedFile).relativePath = path + item.name;
        items.push(item);
      }
    }
    callback();
  }

  private processCallbacks(
    items: Array<(callback: () => void) => void>,
    callback: () => void,
  ): void {
    if (!items || items.length === 0) {
      callback();
      return;
    }
    items[0](() => {
      this.processCallbacks(items.slice(1), callback);
    });
  }

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
        this.processCallbacks(
          allEntries.map((entry) => this.processItem.bind(this, entry, path, items)),
          callback,
        );
      });
    };
    readEntries();
  }

  private appendFilesFromFileList(fileList: File[], event: Event): void {
    let errorCount = 0;
    const o = this.getOpt([
      "maxFiles",
      "minFileSize",
      "maxFileSize",
      "maxFilesErrorCallback",
      "minFileSizeErrorCallback",
      "maxFileSizeErrorCallback",
      "fileType",
      "fileTypeErrorCallback",
    ]) as any;

    if (typeof o.maxFiles !== "undefined" && o.maxFiles < fileList.length + this.files.length) {
      if (o.maxFiles === 1 && this.files.length === 1 && fileList.length === 1) {
        this.removeFile(this.files[0]);
      } else {
        o.maxFilesErrorCallback(fileList, errorCount++);
        return;
      }
    }

    const files: ResumableFile[] = [];
    const filesSkipped: File[] = [];
    let remaining = fileList.length;

    const decreaseRemaining = (): void => {
      if (!--remaining) {
        if (!files.length && !filesSkipped.length) return;
        setTimeout(() => {
          this.dispatch("filesAdded", { files: files, skippedFiles: filesSkipped });
        }, 0);
      }
    };

    for (const file of fileList) {
      const fileName = file.name;
      const fileType = file.type;

      if (o.fileType.length > 0) {
        let fileTypeFound = false;
        for (const index in o.fileType) {
          const typeDef = o.fileType[index].replace(/\s/g, "").toLowerCase();
          let extension = typeDef.match(/^[^.][^/]+$/) ? "." + typeDef : typeDef;
          if (
            fileName.substr(-1 * extension.length).toLowerCase() === extension ||
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
          o.fileTypeErrorCallback(file, errorCount++);
          continue;
        }
      }

      if (typeof o.minFileSize !== "undefined" && file.size < o.minFileSize) {
        o.minFileSizeErrorCallback(file, errorCount++);
        continue;
      }
      if (typeof o.maxFileSize !== "undefined" && file.size > o.maxFileSize) {
        o.maxFileSizeErrorCallback(file, errorCount++);
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

      const uniqueIdentifier = helpers.generateUniqueIdentifier(file, event);
      const customGenerator = this.getOpt("generateUniqueIdentifier");

      if (typeof customGenerator === "function") {
        const result = customGenerator(file, event);
        if (result && typeof (result as any).then === "function") {
          (result as Promise<string>).then(addFile).catch(decreaseRemaining);
        } else {
          addFile(result as string);
        }
      } else {
        addFile(uniqueIdentifier);
      }
    }
  }

  uploadNextChunk(): boolean {
    let found = false;
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
    for (const file of this.files) {
      found = file.upload();
      if (found) return true;
    }
    let outstanding = false;
    for (const file of this.files) {
      if (!file.isComplete()) {
        outstanding = true;
        break;
      }
    }
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
    if (this.isUploading()) return;
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
   * Cancel upload of a specific `ResumableFile` object on the list from the list.
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
    let returnValue: ResumableFile | false = false;
    for (const file of this.files) {
      if (file.uniqueIdentifier === uniqueIdentifier) returnValue = file;
    }
    return returnValue;
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

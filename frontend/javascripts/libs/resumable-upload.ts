/**
 * Configuration options for the Resumable instance.
 */
export interface ConfigurationHash {
  chunkSize?: number;
  forceChunkSize?: boolean;
  simultaneousUploads?: number;
  fileParameterName?: string;
  chunkNumberParameterName?: string;
  chunkSizeParameterName?: string;
  currentChunkSizeParameterName?: string;
  totalSizeParameterName?: string;
  typeParameterName?: string;
  identifierParameterName?: string;
  fileNameParameterName?: string;
  relativePathParameterName?: string;
  totalChunksParameterName?: string;
  dragOverClass?: string;
  throttleProgressCallbacks?: number;
  query?:
    | Record<string, any>
    | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, any>);
  headers?:
    | Record<string, string>
    | ((file: ResumableFile, chunk?: ResumableChunk) => Record<string, string>);
  preprocess?: ((chunk: ResumableChunk) => Promise<void> | void) | null;
  preprocessFile?: ((file: ResumableFile) => Promise<void> | void) | null;
  method?: "multipart" | "octet";
  uploadMethod?: string;
  testMethod?: string;
  prioritizeFirstAndLastChunk?: boolean;
  target?: string | ((params?: any) => string);
  testTarget?: string | null;
  parameterNamespace?: string;
  testChunks?: boolean;
  generateUniqueIdentifier?: ((file: File, event?: Event) => string | Promise<string>) | null;
  getTarget?: ((request: string, params: any) => string) | null;
  maxChunkRetries?: number;
  chunkRetryInterval?: number;
  permanentErrors?: number[];
  maxFiles?: number;
  withCredentials?: boolean;
  xhrTimeout?: number;
  clearInput?: boolean;
  chunkFormat?: "blob" | "base64";
  setChunkTypeFromFile?: boolean;
  maxFilesErrorCallback?: (files: File[], errorCount: number) => void;
  minFileSize?: number;
  minFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  maxFileSize?: number;
  maxFileSizeErrorCallback?: (file: File, errorCount: number) => void;
  fileType?: string[];
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

  generateUniqueIdentifier(file: File, event?: Event): string {
    const relativePath =
      (file as any).webkitRelativePath || (file as any).relativePath || file.name;
    const size = file.size;
    return size + "-" + relativePath.replace(/[^0-9a-zA-Z_-]/gim, "");
  },

  contains<T>(array: T[], test: T): boolean {
    return array.includes(test);
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
    this._status = "uploading";

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
        this._status = "success";
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
        helpers.contains(this.getOpt("permanentErrors") as number[], response.status) ||
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
  resumableObj: Resumable;
  file: File;
  fileName: string;
  size: number;
  relativePath: string;
  uniqueIdentifier: string;
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

  progress(): number {
    if (this._error) return 1;
    let ret = 0;
    let error = false;
    for (const c of this.chunks) {
      if (c.status() === "error") error = true;
      ret += c.progress(true);
    }
    ret = error ? 1 : ret > 0.99999 ? 1 : ret;
    ret = Math.max(this._prevProgress, ret);
    this._prevProgress = ret;
    return ret;
  }

  isUploading(): boolean {
    return this.chunks.some((chunk) => chunk.status() === "uploading");
  }

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
          case 0:
            this.preprocessState = 1;
            const result = preprocess(this);
            if (result instanceof Promise) result.catch(() => {});
            return true;
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
  support: boolean;
  files: ResumableFile[] = [];
  defaults: Required<ConfigurationHash>;
  opts: Partial<ConfigurationHash>;
  version = 1.0;

  private _eventTarget: EventTarget;

  constructor(opts: Partial<ConfigurationHash> = {}) {
    this._eventTarget = new EventTarget();

    this.support =
      typeof File !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof FileList !== "undefined" &&
      !!Blob.prototype.slice &&
      typeof fetch !== "undefined" &&
      typeof AbortController !== "undefined";

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
      xhrTimeout: 0,
      clearInput: true,
      chunkFormat: "blob",
      setChunkTypeFromFile: false,
      maxFilesErrorCallback: (files: File[], errorCount: number) => {
        const maxFiles = this.getOpt("maxFiles");
        alert(`Please upload no more than ${maxFiles} file${maxFiles === 1 ? "" : "s"} at a time.`);
      },
      minFileSize: 1,
      minFileSizeErrorCallback: (file: File, errorCount: number) => {
        alert(
          `${file.name} is too small, please upload files larger than ${helpers.formatSize(this.getOpt("minFileSize") as number)}.`,
        );
      },
      maxFileSize: undefined,
      maxFileSizeErrorCallback: (file: File, errorCount: number) => {
        alert(
          `${file.name} is too large, please upload files less than ${helpers.formatSize(this.getOpt("maxFileSize") as number)}.`,
        );
      },
      fileType: [],
      fileTypeErrorCallback: (file: File, errorCount: number) => {
        alert(
          `${file.name} has type not allowed, please upload files of type ${this.getOpt("fileType")}.`,
        );
      },
    };

    this.opts = opts;
  }

  // EventTarget Implementation via Composition
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions | undefined,
  ): void {
    this._eventTarget.addEventListener(type, callback, options);
  }

  dispatchEvent(event: Event): boolean {
    return this._eventTarget.dispatchEvent(event);
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
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

  // --- Drag and Drop Handlers ---
  private onDrop = (e: DragEvent): void => {
    (e.currentTarget as HTMLElement)?.classList.remove(this.getOpt("dragOverClass") as string);
    helpers.stopEvent(e);
    if (e.dataTransfer?.items) {
      this.loadFiles(e.dataTransfer.items, e);
    } else if (e.dataTransfer?.files) {
      this.loadFiles(e.dataTransfer.files, e);
    }
  };

  private onDragLeave = (e: DragEvent): void => {
    (e.currentTarget as HTMLElement)?.classList.remove(this.getOpt("dragOverClass") as string);
  };

  private onDragOverEnter = (e: DragEvent): void => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (dt && dt.types.includes("Files")) {
      e.stopPropagation();
      dt.dropEffect = "copy";
      dt.effectAllowed = "copy";
      (e.currentTarget as HTMLElement)?.classList.add(this.getOpt("dragOverClass") as string);
    } else if (dt) {
      dt.dropEffect = "none";
      dt.effectAllowed = "none";
    }
  };

  private processItem(item: any, path: string, items: ExtendedFile[], cb: () => void): void {
    let entry: any;
    if (item.isFile) {
      return item.file((file: File) => {
        (file as ExtendedFile).relativePath = path + file.name;
        items.push(file as ExtendedFile);
        cb();
      });
    } else if (item.isDirectory) {
      entry = item;
    } else if (item instanceof File) {
      items.push(item);
    }
    if (typeof item.webkitGetAsEntry === "function") {
      entry = item.webkitGetAsEntry();
    }
    if (entry && entry.isDirectory) {
      return this.processDirectory(entry, path + entry.name + "/", items, cb);
    }
    if (typeof item.getAsFile === "function") {
      item = item.getAsFile();
      if (item instanceof File) {
        (item as ExtendedFile).relativePath = path + item.name;
        items.push(item);
      }
    }
    cb();
  }

  private processCallbacks(items: Array<(cb: () => void) => void>, cb: () => void): void {
    if (!items || items.length === 0) return cb();
    items[0](() => {
      this.processCallbacks(items.slice(1), cb);
    });
  }

  private processDirectory(
    directory: any,
    path: string,
    items: ExtendedFile[],
    cb: () => void,
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
          cb,
        );
      });
    };
    readEntries();
  }

  private loadFiles(items: DataTransferItemList | FileList, event: Event): void {
    if (!items.length) return;
    this.dispatch("beforeAdd");
    const files: ExtendedFile[] = [];
    this.processCallbacks(
      Array.from(items).map((item: any) => {
        const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : item;
        return this.processItem.bind(this, entry, "", files);
      }),
      () => {
        if (files.length) this.appendFilesFromFileList(files, event);
      },
    );
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

  assignBrowse(domNodes: Element | Element[], isDirectory = false): void {
    const nodes = Array.isArray(domNodes) ? domNodes : [domNodes];
    for (const domNode of nodes) {
      let input: HTMLInputElement;
      if (domNode.tagName === "INPUT" && (domNode as HTMLInputElement).type === "file") {
        input = domNode as HTMLInputElement;
      } else {
        input = document.createElement("input");
        input.setAttribute("type", "file");
        input.style.display = "none";
        domNode.addEventListener(
          "click",
          () => {
            input.style.opacity = "0";
            input.style.display = "block";
            input.focus();
            input.click();
            input.style.display = "none";
          },
          false,
        );
        domNode.appendChild(input);
      }
      const maxFiles = this.getOpt("maxFiles");
      if (typeof maxFiles === "undefined" || maxFiles !== 1) {
        input.setAttribute("multiple", "multiple");
      } else {
        input.removeAttribute("multiple");
      }
      if (isDirectory) {
        input.setAttribute("webkitdirectory", "webkitdirectory");
      } else {
        input.removeAttribute("webkitdirectory");
      }
      const fileTypes = this.getOpt("fileType") as string[];
      if (typeof fileTypes !== "undefined" && fileTypes.length >= 1) {
        input.setAttribute(
          "accept",
          fileTypes
            .map((e) => {
              e = e.replace(/\s/g, "").toLowerCase();
              return e.match(/^[^.][^/]+$/) ? "." + e : e;
            })
            .join(","),
        );
      } else {
        input.removeAttribute("accept");
      }
      input.addEventListener(
        "change",
        (e) => {
          this.appendFilesFromFileList(Array.from((e.target as HTMLInputElement).files || []), e);
          if (this.getOpt("clearInput")) (e.target as HTMLInputElement).value = "";
        },
        false,
      );
    }
  }

  assignDrop(domNodes: Element | Element[]): void {
    const nodes = Array.isArray(domNodes) ? domNodes : [domNodes];
    for (const domNode of nodes) {
      domNode.addEventListener("dragover", this.onDragOverEnter as EventListener, false);
      domNode.addEventListener("dragenter", this.onDragOverEnter as EventListener, false);
      domNode.addEventListener("dragleave", this.onDragLeave as EventListener, false);
      domNode.addEventListener("drop", this.onDrop as EventListener, false);
    }
  }

  unAssignDrop(domNodes: Element | Element[]): void {
    const nodes = Array.isArray(domNodes) ? domNodes : [domNodes];
    for (const domNode of nodes) {
      domNode.removeEventListener("dragover", this.onDragOverEnter as EventListener);
      domNode.removeEventListener("dragenter", this.onDragOverEnter as EventListener);
      domNode.removeEventListener("dragleave", this.onDragLeave as EventListener);
      domNode.removeEventListener("drop", this.onDrop as EventListener);
    }
  }

  isUploading(): boolean {
    return this.files.some((file) => file.isUploading());
  }

  upload(): void {
    if (this.isUploading()) return;
    this.dispatch("uploadStart");
    for (let num = 1; num <= (this.getOpt("simultaneousUploads") as number); num++) {
      this.uploadNextChunk();
    }
  }

  pause(): void {
    for (const file of this.files) file.abort();
    this.dispatch("pause");
  }

  cancel(): void {
    this.dispatch("beforeCancel");
    for (let i = this.files.length - 1; i >= 0; i--) this.files[i].cancel();
    this.dispatch("cancel");
  }

  progress(): number {
    let totalDone = 0;
    let totalSize = 0;
    for (const file of this.files) {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    }
    return totalSize > 0 ? totalDone / totalSize : 0;
  }

  addFile(file: File, event?: Event): void {
    this.dispatch("beforeAdd");
    this.appendFilesFromFileList([file], event || new Event("addFile"));
  }

  addFiles(files: File[], event?: Event): void {
    this.dispatch("beforeAdd");
    this.appendFilesFromFileList(files, event || new Event("addFiles"));
  }

  removeFile(file: ResumableFile): void {
    for (let i = this.files.length - 1; i >= 0; i--) {
      if (this.files[i] === file) this.files.splice(i, 1);
    }
  }

  getFromUniqueIdentifier(uniqueIdentifier: string): ResumableFile | false {
    let ret: ResumableFile | false = false;
    for (const f of this.files) {
      if (f.uniqueIdentifier === uniqueIdentifier) ret = f;
    }
    return ret;
  }

  getSize(): number {
    let totalSize = 0;
    for (const file of this.files) totalSize += file.size;
    return totalSize;
  }

  handleDropEvent(e: DragEvent): void {
    this.onDrop(e);
  }

  handleChangeEvent(e: Event): void {
    const target = e.target as HTMLInputElement;
    this.appendFilesFromFileList(Array.from(target.files || []), e);
    target.value = "";
  }

  updateQuery(query: Record<string, any>): void {
    this.opts.query = query;
  }
}

export default Resumable;

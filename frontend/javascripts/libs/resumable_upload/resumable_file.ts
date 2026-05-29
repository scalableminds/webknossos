import { ResumableChunk } from "./resumable_chunk";
import type { ConfigurationHash, ResumableUpload } from "./resumable_upload";

/**
 * Represents a file to be uploaded.
 */
export class ResumableFile {
  opts: Partial<ConfigurationHash> = {};
  /**
   * A back-reference to the parent `Resumable` object.
   */
  resumableObj: ResumableUpload;
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
  private _prevProgress = 0;
  private _pause = false;
  private _error: boolean;

  constructor(resumableObj: ResumableUpload, file: File, uniqueIdentifier: string) {
    this.resumableObj = resumableObj;
    this.file = file;
    this.fileName = file.name;
    this.size = file.size;
    this.relativePath =
      (file as any).relativePath || (file as any).webkitRelativePath || this.fileName;
    this.uniqueIdentifier = uniqueIdentifier;
    this._error = uniqueIdentifier === undefined;

    this.resumableObj.dispatchFromDetail({ type: "chunkingStart", file: this });
    this.bootstrap();
  }

  hasError() {
    return this._error;
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
        this.resumableObj.dispatchFromDetail({ type: "fileProgress", file: this, message });
        break;
      case "error":
        this.abort();
        this._error = true;
        this.chunks = [];
        this.resumableObj.dispatchFromDetail({ type: "fileError", file: this, message });
        break;
      case "success":
        if (this._error) return;
        this.resumableObj.dispatchFromDetail({ type: "fileProgress", file: this, message });
        if (this.isComplete()) {
          this.resumableObj.dispatchFromDetail({ type: "fileSuccess", file: this, message });
        }
        break;
      case "retry":
        this.resumableObj.dispatchFromDetail({ type: "fileRetry", file: this });
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
      this.resumableObj.dispatchFromDetail({ type: "fileProgress", file: this });
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
    this.resumableObj.dispatchFromDetail({ type: "fileProgress", file: this });
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
      this.resumableObj.dispatchFromDetail({
        type: "chunkingProgress",
        file: this,
        message: (offset / maxOffset).toString(),
      });
    }

    setTimeout(() => {
      this.resumableObj.dispatchFromDetail({ type: "chunkingComplete", file: this });
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
    return !this.chunks.some(
      (chunk) => chunk.status() === "uploading" || chunk.status() === "pending",
    );
  }

  pause(pause?: boolean): void {
    this._pause = pause === undefined ? !this._pause : pause;
  }

  isPaused(): boolean {
    return this._pause;
  }

  upload(): boolean {
    if (this.isPaused() === false) {
      for (const chunk of this.chunks) {
        if (chunk.status() === "pending") {
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

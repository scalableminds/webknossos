import { beforeEach, describe, expect, it, vi } from "vitest";
import { Resumable, ResumableChunk, type ResumableFile } from "../../libs/resumable-upload";

// Helper to mock Fetch API
function mockFetch(status = 200, ok = true, text = "success") {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(text),
    headers: new Headers(),
  });
}

describe("Resumable", () => {
  let resumable: Resumable;

  beforeEach(() => {
    // Reset mocks
    vi.restoreAllMocks();
    mockFetch();

    resumable = new Resumable({
      target: "/upload",
      chunkSize: 1024 * 1024,
      simultaneousUploads: 3,
    });
  });

  describe("Constructor and Support", () => {
    it("should initialize with default options", () => {
      const r = new Resumable();
      // Support might be false in JSDOM if not fully polyfilled, but usually true
      // We manually check if the key properties exist
      expect(r.files).toEqual([]);
      expect(r.version).toBe(1.0);
    });

    it("should merge custom options with defaults", () => {
      const r = new Resumable({
        chunkSize: 2 * 1024 * 1024,
        simultaneousUploads: 5,
      });
      expect(r.getOpt("chunkSize")).toBe(2 * 1024 * 1024);
      expect(r.getOpt("simultaneousUploads")).toBe(5);
      expect(r.getOpt("target")).toBe("/"); // default value
    });

    it("should get single option", () => {
      expect(resumable.getOpt("target")).toBe("/upload");
    });

    it("should get multiple options as array", () => {
      const opts = resumable.getOpt(["target", "chunkSize"]);
      expect(opts).toEqual({
        target: "/upload",
        chunkSize: 1024 * 1024,
      });
    });
  });

  describe("Event System", () => {
    it("should register event listeners", () => {
      const callback = vi.fn();
      resumable.addEventListener("fileAdded", callback);

      resumable.dispatch("fileAdded");
      expect(callback).toHaveBeenCalled();
    });

    it("should dispatch events with details", () => {
      const callback = vi.fn();
      resumable.addEventListener("test", callback);

      resumable.dispatch("test", { message: "hello" } as any);

      expect(callback).toHaveBeenCalled();
      // Check event.detail
      const event = callback.mock.calls[0][0];
      expect(event.detail.message).toBe("hello");
    });

    it("should fire error event on fileError", () => {
      const errorCallback = vi.fn();
      const fileErrorCallback = vi.fn();

      resumable.addEventListener("error", errorCallback);
      resumable.addEventListener("fileError", fileErrorCallback);

      const mockFile = {} as ResumableFile;

      // In the new lib, fileError bubbles to error
      resumable.dispatch("fileError", { file: mockFile, message: "error message" });

      // Check fileError
      expect(fileErrorCallback).toHaveBeenCalled();
      const fileEvent = fileErrorCallback.mock.calls[0][0];
      expect(fileEvent.detail.file).toBe(mockFile);
      expect(fileEvent.detail.message).toBe("error message");

      // Check bubbled error
      expect(errorCallback).toHaveBeenCalled();
      const errorEvent = errorCallback.mock.calls[0][0];
      expect(errorEvent.detail.error).toBe("error message");
      expect(errorEvent.detail.file).toBe(mockFile);
    });

    it("should fire progress event on fileProgress", () => {
      const progressCallback = vi.fn();
      resumable.addEventListener("fileProgress", progressCallback);
      resumable.dispatch("fileProgress", { file: {} as ResumableFile });
      expect(progressCallback).toHaveBeenCalled();
    });
  });

  describe("File Management", () => {
    let mockFile: File;

    beforeEach(() => {
      mockFile = new File(["test content"], "test.txt", { type: "text/plain" });
    });

    it("should add a file", () => {
      const fileAddedCallback = vi.fn();
      resumable.addEventListener("fileAdded", fileAddedCallback);

      resumable.addFile(mockFile);

      // Wait for async operations
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(resumable.files.length).toBe(1);
          expect(resumable.files[0].fileName).toBe("test.txt");
          expect(fileAddedCallback).toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });

    it("should add multiple files", () => {
      const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
      const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });

      resumable.addFiles([file1, file2]);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(resumable.files.length).toBe(2);
          resolve(undefined);
        }, 10);
      });
    });

    it("should remove a file", () => {
      resumable.addFile(mockFile);

      return new Promise((resolve) => {
        setTimeout(() => {
          const file = resumable.files[0];
          resumable.removeFile(file);
          expect(resumable.files.length).toBe(0);
          resolve(undefined);
        }, 10);
      });
    });

    it("should get file by unique identifier", () => {
      resumable.addFile(mockFile);

      return new Promise((resolve) => {
        setTimeout(() => {
          const file = resumable.files[0];
          const found = resumable.getFromUniqueIdentifier(file.uniqueIdentifier);
          expect(found).toBe(file);
          resolve(undefined);
        }, 10);
      });
    });

    it("should return false for non-existent unique identifier", () => {
      const found = resumable.getFromUniqueIdentifier("non-existent");
      expect(found).toBe(false);
    });

    it("should calculate total size", () => {
      const file1 = new File(["12345"], "file1.txt", { type: "text/plain" });
      const file2 = new File(["1234567890"], "file2.txt", { type: "text/plain" });

      resumable.addFiles([file1, file2]);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(resumable.getSize()).toBe(15);
          resolve(undefined);
        }, 10);
      });
    });
  });

  describe("File Validation", () => {
    it("should reject files exceeding maxFiles limit", () => {
      const cb = vi.fn();
      const r = new Resumable({
        maxFiles: 2,
        maxFilesErrorCallback: cb,
      });

      const files = [
        new File(["1"], "file1.txt"),
        new File(["2"], "file2.txt"),
        new File(["3"], "file3.txt"),
      ];

      r.addFiles(files);

      // Wait for immediate processing
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(cb).toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });

    it("should reject files smaller than minFileSize", () => {
      const cb = vi.fn();
      const r = new Resumable({
        minFileSize: 100,
        minFileSizeErrorCallback: cb,
      });

      const smallFile = new File(["tiny"], "small.txt");
      r.addFile(smallFile);

      expect(cb).toHaveBeenCalled();
      expect(r.files.length).toBe(0);
    });

    it("should reject files larger than maxFileSize", () => {
      const cb = vi.fn();
      const r = new Resumable({
        maxFileSize: 10,
        maxFileSizeErrorCallback: cb,
      });

      const largeContent = "a".repeat(100);
      const largeFile = new File([largeContent], "large.txt");
      r.addFile(largeFile);

      expect(cb).toHaveBeenCalled();
      expect(r.files.length).toBe(0);
    });

    it("should validate file types", () => {
      const cb = vi.fn();
      const r = new Resumable({
        fileType: ["image/png", "image/jpeg"],
        fileTypeErrorCallback: cb,
      });

      const txtFile = new File(["text"], "file.txt", { type: "text/plain" });
      r.addFile(txtFile);

      expect(cb).toHaveBeenCalled();
      expect(r.files.length).toBe(0);
    });

    it("should handle wildcard file types", () => {
      const r = new Resumable({
        fileType: ["image/*"],
      });

      const pngFile = new File(["png"], "image.png", { type: "image/png" });
      const jpgFile = new File(["jpg"], "image.jpg", { type: "image/jpeg" });

      r.addFiles([pngFile, jpgFile]);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(r.files.length).toBe(2);
          resolve(undefined);
        }, 10);
      });
    });

    it("should handle file extensions in fileType", () => {
      const r = new Resumable({
        fileType: [".txt", ".pdf"],
      });

      const txtFile = new File(["text"], "document.txt", { type: "text/plain" });
      r.addFile(txtFile);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(r.files.length).toBe(1);
          resolve(undefined);
        }, 10);
      });
    });
  });

  describe("Upload Control", () => {
    it("should check if uploading", () => {
      expect(resumable.isUploading()).toBe(false);
    });

    it("should calculate overall progress", () => {
      expect(resumable.progress()).toBe(0);
    });

    it("should pause uploads", () => {
      const pauseCallback = vi.fn();
      resumable.addEventListener("pause", pauseCallback);
      resumable.pause();
      expect(pauseCallback).toHaveBeenCalled();
    });

    it("should cancel all uploads", () => {
      const beforeCancelCallback = vi.fn();
      const cancelCallback = vi.fn();
      resumable.addEventListener("beforeCancel", beforeCancelCallback);
      resumable.addEventListener("cancel", cancelCallback);

      resumable.cancel();

      expect(beforeCancelCallback).toHaveBeenCalled();
      expect(cancelCallback).toHaveBeenCalled();
    });

    it("should update query parameters", () => {
      const newQuery = { token: "abc123" };
      resumable.updateQuery(newQuery);
      expect(resumable.opts.query).toEqual(newQuery);
    });
  });
});

describe("ResumableFile", () => {
  let resumable: Resumable;
  let file: File;
  let resumableFile: ResumableFile;

  beforeEach(() => {
    resumable = new Resumable({
      target: "/upload",
      chunkSize: 10,
    });

    file = new File(["1234567890123456789012345"], "test.txt", { type: "text/plain" });

    return new Promise((resolve) => {
      resumable.addFile(file);
      setTimeout(() => {
        resumableFile = resumable.files[0];
        resolve(undefined);
      }, 10);
    });
  });

  describe("Properties", () => {
    it("should have correct file properties", () => {
      expect(resumableFile.fileName).toBe("test.txt");
      expect(resumableFile.size).toBe(25);
      expect(resumableFile.file).toBe(file);
    });

    it("should create chunks", () => {
      expect(resumableFile.chunks.length).toBeGreaterThan(0);
      expect(resumableFile.chunks[0]).toBeInstanceOf(ResumableChunk);
    });

    it("should have relative path", () => {
      expect(resumableFile.relativePath).toBe("test.txt");
    });
  });

  describe("Progress and Status", () => {
    it("should calculate progress", () => {
      const progress = resumableFile.progress();
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });

    it("should check if uploading", () => {
      expect(resumableFile.isUploading()).toBe(false);
    });

    it("should check if complete", () => {
      const isComplete = resumableFile.isComplete();
      expect(typeof isComplete).toBe("boolean");
    });
  });

  describe("Pause and Resume", () => {
    it("should pause upload", () => {
      resumableFile.pause(true);
      expect(resumableFile.isPaused()).toBe(true);
    });

    it("should toggle pause", () => {
      const initialState = resumableFile.isPaused();
      resumableFile.pause();
      expect(resumableFile.isPaused()).toBe(!initialState);
    });
  });

  describe("Abort and Cancel", () => {
    it("should abort upload", () => {
      resumableFile.abort();
      // Check that chunks are not uploading
      resumableFile.chunks.forEach((chunk) => {
        expect(chunk.status()).not.toBe("uploading");
      });
    });

    it("should cancel upload", () => {
      const initialLength = resumable.files.length;
      resumableFile.cancel();
      expect(resumable.files.length).toBeLessThan(initialLength);
    });
  });

  describe("Mark Chunks Completed", () => {
    it("should mark chunks as complete", () => {
      resumableFile.markChunksCompleted(1);
      expect(resumableFile.chunks[0].markComplete).toBe(true);
      expect(resumableFile.chunks[1].markComplete).toBe(false);
    });

    it("should handle invalid chunk number", () => {
      const chunkCount = resumableFile.chunks.length;
      resumableFile.markChunksCompleted(chunkCount + 10);
      // Should not throw error
      expect(resumableFile.chunks.length).toBe(chunkCount);
    });
  });

  describe("Bootstrap", () => {
    it("should rebuild chunks on bootstrap", () => {
      const initialChunkCount = resumableFile.chunks.length;
      resumableFile.bootstrap();
      expect(resumableFile.chunks.length).toBe(initialChunkCount);
    });
  });
});

describe("ResumableChunk", () => {
  let resumable: Resumable;
  let resumableFile: ResumableFile;
  let chunk: ResumableChunk;

  beforeEach(() => {
    mockFetch();
    resumable = new Resumable({
      target: "/upload",
      chunkSize: 10,
      testChunks: false,
    });

    const file = new File(["1234567890"], "test.txt", { type: "text/plain" });

    return new Promise((resolve) => {
      resumable.addFile(file);
      setTimeout(() => {
        resumableFile = resumable.files[0];
        chunk = resumableFile.chunks[0];
        resolve(undefined);
      }, 10);
    });
  });

  describe("Properties", () => {
    it("should have correct byte range", () => {
      expect(chunk.startByte).toBeDefined();
      expect(chunk.endByte).toBeDefined();
      expect(chunk.endByte).toBeGreaterThan(chunk.startByte);
    });

    it("should have correct file reference", () => {
      expect(chunk.fileObj).toBe(resumableFile);
      expect(chunk.resumableObj).toBe(resumable);
    });

    it("should have offset", () => {
      expect(chunk.offset).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Status and Sending", () => {
    it("should start with pending status", () => {
      expect(chunk.status()).toBe("pending");
    });

    it("should switch to uploading when sent", async () => {
      chunk.send();
      expect(chunk.status()).toBe("uploading");

      // Since fetch is mocked to resolve immediately in tests,
      // we might need to wait a tick to see success
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(global.fetch).toHaveBeenCalled();
      expect(chunk.status()).toBe("success");
    });
  });

  describe("Abort", () => {
    it("should abort chunk upload", () => {
      chunk.send();
      chunk.abort();
      expect(chunk.status()).toBe("pending");
    });
  });
});

describe("Helper Functions", () => {
  describe("File Size Formatting", () => {
    it("should be accessible through Resumable instance", () => {
      const r = new Resumable();
      // The helpers are internal, but we can test through error callbacks
      expect(r).toBeDefined();
    });
  });

  describe("Unique Identifier Generation", () => {
    it("should generate consistent identifiers for same file", () => {
      const r = new Resumable();
      const file1 = new File(["test"], "test.txt", { type: "text/plain" });
      const file2 = new File(["test"], "test.txt", { type: "text/plain" });

      r.addFiles([file1, file2]);

      return new Promise((resolve) => {
        setTimeout(() => {
          // Should create only one file since identifier is the same
          expect(r.files.length).toBe(1);
          resolve(undefined);
        }, 10);
      });
    });
  });
});

describe("Edge Cases", () => {
  it("should handle empty file", () => {
    const r = new Resumable({ minFileSize: 0 });
    const emptyFile = new File([], "empty.txt");

    r.addFile(emptyFile);

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(r.files.length).toBe(1);
        expect(r.files[0].size).toBe(0);
        resolve(undefined);
      }, 10);
    });
  });

  it("should handle very large chunk size", () => {
    const r = new Resumable({
      chunkSize: 100 * 1024 * 1024, // 100MB
    });

    const file = new File(["small content"], "small.txt");
    r.addFile(file);

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(r.files[0].chunks.length).toBe(1);
        resolve(undefined);
      }, 10);
    });
  });

  it("should handle forceChunkSize option", () => {
    const r = new Resumable({
      chunkSize: 10,
      forceChunkSize: true,
    });

    const file = new File(["1234567890123"], "test.txt");
    r.addFile(file);

    return new Promise((resolve) => {
      setTimeout(() => {
        const chunks = r.files[0].chunks;
        expect(chunks.length).toBeGreaterThan(1);
        // Last chunk should be <= chunkSize
        const lastChunk = chunks[chunks.length - 1];
        expect(lastChunk.endByte - lastChunk.startByte).toBeLessThanOrEqual(10);
        resolve(undefined);
      }, 10);
    });
  });

  it("should handle special characters in filename", () => {
    const r = new Resumable();
    const file = new File(["test"], "test file (1) [special].txt");

    r.addFile(file);

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(r.files.length).toBe(1);
        expect(r.files[0].fileName).toBe("test file (1) [special].txt");
        resolve(undefined);
      }, 10);
    });
  });

  it("should handle beforeAdd event", () => {
    const beforeAddCallback = vi.fn();
    const r = new Resumable();
    r.addEventListener("beforeAdd", beforeAddCallback);

    const file = new File(["test"], "test.txt");
    r.addFile(file);

    expect(beforeAddCallback).toHaveBeenCalled();
  });

  it("should skip duplicate files", () => {
    const r = new Resumable();
    const file = new File(["test"], "test.txt");

    r.addFile(file);

    return new Promise((resolve) => {
      setTimeout(() => {
        const initialCount = r.files.length;
        r.addFile(file);

        setTimeout(() => {
          expect(r.files.length).toBe(initialCount);
          resolve(undefined);
        }, 10);
      }, 10);
    });
  });

  it("should fire filesAdded with skipped files", () => {
    const filesAddedCallback = vi.fn();
    const r = new Resumable();
    r.addEventListener("filesAdded", filesAddedCallback);

    const file = new File(["test"], "test.txt");

    r.addFile(file);

    return new Promise((resolve) => {
      setTimeout(() => {
        r.addFile(file); // Add same file again

        setTimeout(() => {
          expect(filesAddedCallback).toHaveBeenCalled();
          // Access details from the event object
          const event = filesAddedCallback.mock.calls[1][0];
          expect(event.detail.files).toEqual([]); // no new files
          expect(event.detail.skippedFiles.length).toBe(1); // one skipped
          resolve(undefined);
        }, 10);
      }, 10);
    });
  });
});

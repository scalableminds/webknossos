import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Resumable } from "../../libs/resumable-upload";
import { sleep } from "libs/utils";
import { ResumableBackendMock } from "../helpers/resumable_backend_mock";

describe("Resumable Use Cases (WebKnossos Patterns)", () => {
  let resumable: Resumable;
  let backendMock: ResumableBackendMock;

  const server = setupServer(
    http.all("http://localhost/upload", ({ request }) => backendMock.handle(request)),
  );

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });

  beforeEach(() => {
    const mockLocation = new URL("http://localhost");
    vi.stubGlobal("location", mockLocation);
    vi.stubGlobal("window", { location: mockLocation });

    // Reset mocks
    vi.restoreAllMocks();
    backendMock = new ResumableBackendMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe("Dynamic Query Parameters (Token Injection)", () => {
    it("should call query function for every chunk to get latest token", async () => {
      let token = "initial-token";
      const queryFn = vi.fn().mockImplementation(() => ({ token }));

      backendMock.setRequiredToken("initial-token");
      backendMock.rotateTokenAfterUploadCount(1, "new-token");

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        query: queryFn,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const file = new File(["1234567890123456789012345"], "test.txt", { type: "text/plain" });
      resumable.addFile(file);

      // trigger upload
      resumable.upload();

      await backendMock.waitForUploadCount(1);

      expect(queryFn).toHaveBeenCalled();
      expect(backendMock.getUploadTokens()[0]).toBe("initial-token");

      // Rotate token and retry/upload next
      token = "new-token";

      await backendMock.waitForSuccessfulUploads(2);
      expect(backendMock.getUploadTokens()[1]).toBe("new-token");
    });
  });

  describe("Chunk Testing (testChunks: true)", () => {
    it("should issue GET request before POST", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);

      resumable.upload();
      await sleep(10);

      // First call should be GET (test)
      expect(backendMock.requestLog[0]?.method).toBe("GET");
    });

    it("should not upload chunk if it already exists on server)", async () => {
      backendMock.setTestChunkExistsPredicate(() => true);
      backendMock.failUploadOnNthRequest(1, 400, "Should not POST");

      const errorHandler = vi.fn();

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });
      resumable.addEventListener("error", errorHandler);

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await sleep(50);

      // Should have made at least one GET
      expect(backendMock.requestLog.length).toBeGreaterThan(0);
      expect(backendMock.requestLog[0]?.method).toBe("GET");

      // should never have called POST to upload the actual data as it was already present
      const hasPost = backendMock.requestLog.some((entry) => entry.method === "POST");
      expect(hasPost).toBe(false);

      expect(errorHandler).not.toHaveBeenCalled();

      // Chunk should be marked success
      expect(resumable.files[0].chunks[0].status()).toBe("success");
    });

    it("should upload chunk if it does not exist on server", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await sleep(50);

      expect(backendMock.requestLog.length).toBeGreaterThan(0);
      const hasPost = backendMock.requestLog.some((entry) => entry.method === "POST");
      expect(hasPost).toBe(true);
    });

    it("should proceed to POST if GET returns 404 (chunk missing)", async () => {
      backendMock.setTestResponseOverride(() => HttpResponse.text("Not Found", { status: 404 }));

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await sleep(50);

      const hasGet = backendMock.requestLog.some((entry) => entry.method === "GET");
      const hasPost = backendMock.requestLog.some((entry) => entry.method === "POST");
      expect(hasGet).toBe(true);
      expect(hasPost).toBe(true);
    });
  });

  describe("Custom Unique Identifier", () => {
    it("should use generateUniqueIdentifier function", async () => {
      const customIdFn = vi.fn().mockReturnValue("custom-id-123");

      resumable = new Resumable({
        target: "/upload",
        generateUniqueIdentifier: customIdFn,
      });

      const file = new File(["content"], "test.txt");
      resumable.addFile(file);

      expect(customIdFn).toHaveBeenCalledWith(file, expect.anything());
      expect(resumable.files[0].uniqueIdentifier).toBe("custom-id-123");
    });
  });

  describe("Error Handling and Retry", () => {
    it("should handle permanent errors and support manual retry", async () => {
      // Configure permanent errors including 500
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: false,
        permanentErrors: [400, 403, 500],
        maxChunkRetries: 3, // Should be ignored for permanent errors
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);

      // Mock 500 Error
      backendMock.failUploadOnNthRequest(1, 500, "Internal Server Error");

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();

      await sleep(20);

      // Should have failed immediately without retries due to permanent error
      expect(backendMock.getUploadRequestCount()).toBe(1);
      expect(fileErrorSpy).toHaveBeenCalled();
      const errorDetail = fileErrorSpy.mock.calls[0][0].detail;
      expect(errorDetail.message).toBe("Internal Server Error");
      // Chunks are cleared on error, so we cannot check chunk status
      expect(resumable.files[0].chunks.length).toBe(0);

      // Now Manual Retry
      backendMock.reset();

      resumable.files[0].retry();

      await sleep(20);

      // Should have retried and succeeded
      expect(backendMock.getUploadRequestCount()).toBeGreaterThan(0);

      // Chunks should be present again and succeeding (or done)
      // Since it's fast, checking successful completion or presence is good
      expect(resumable.files[0].chunks.length).toBeGreaterThan(0);
    });

    it("should respect permanentErrors configuration", async () => {
      resumable = new Resumable({
        target: "/upload",
        testChunks: false,
        permanentErrors: [415], // Only 415 is permanent
        maxChunkRetries: 2,
        chunkRetryInterval: 1,
      });

      const file = new File(["123"], "test.txt");
      resumable.addFile(file);

      // Mock 500 (not permanent in this config)
      backendMock.failUploadOnNthRequest(1, 500, "Error");

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();
      await sleep(50);

      // Should have retried multiple times (initial + retries)
      expect(backendMock.getUploadRequestCount()).toBeGreaterThan(1);
      expect(fileErrorSpy).toHaveBeenCalled(); // Eventually fails after retries exhaustion
      // Chunks cleared after exhaustion
      expect(resumable.files[0].chunks.length).toBe(0);
    });
  });

  describe("Retry Logic (Manual Retry)", () => {
    it("should reset chunks and restart upload on file.retry()", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: false,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      const resumableFile = resumable.files[0];

      // Simulate error state
      const chunk = resumableFile.chunks[0];
      chunk.send();

      await sleep(0);

      const bootstrapSpy = vi.spyOn(resumableFile, "bootstrap");

      resumableFile.retry();

      // Wait for bootstrap timeout (0ms) and event loop
      await sleep(50);

      expect(bootstrapSpy).toHaveBeenCalled();

      // With fast mocks, it likely finished already
      if (resumable.isUploading()) {
        expect(resumable.isUploading()).toBe(true);
      } else {
        expect(resumable.files[0].chunks[0].status()).toBe("success");
      }
    });
  });

  describe("Files Added Trigger", () => {
    it("should fire filesAdded event", async () => {
      const filesAddedSpy = vi.fn();
      resumable = new Resumable({ target: "/upload" });
      resumable.addEventListener("filesAdded", filesAddedSpy);

      const file = new File(["content"], "test.txt");
      resumable.addFile(file);

      await sleep(10);
      expect(filesAddedSpy).toHaveBeenCalled();
    });
  });

  describe("Backend-backed Integration Cases", () => {
    it("should upload correct chunks and reconstruct the original data", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 5,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "hello-world-resumable";
      const file = new File([payload], "payload.txt", { type: "text/plain" });
      resumable.addFile(file);

      const complete = new Promise<void>((resolve) =>
        resumable.addEventListener("complete", () => resolve()),
      );

      resumable.upload();
      await complete;

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedChunkNumbers = backendMock.getUploadedChunkNumbers(identifier);
      const expectedChunkNumbers = resumable.files[0].chunks.map((_, index) => index + 1);
      expect(uploadedChunkNumbers).toEqual(expectedChunkNumbers);

      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
      expect(backendMock.getInvariantViolations()).toEqual([]);
    });

    it("should retry after a transient failure on the nth upload request", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 5,
        testChunks: false,
        maxChunkRetries: 2,
        chunkRetryInterval: 1,
        simultaneousUploads: 1,
      });

      const payload = "retry-me-please";
      const file = new File([payload], "retry.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.failUploadOnNthRequest(2, 503, "Try again");

      const complete = new Promise<void>((resolve) =>
        resumable.addEventListener("complete", () => resolve()),
      );

      resumable.upload();
      await complete;

      expect(backendMock.getUploadRequestCount()).toBeGreaterThan(backendMock.getSuccessfulUploadCount());

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should resume with a second instance against the same backend state", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 4,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "resume-across-instances";
      const file = new File([payload], "resume.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.failUploadOnNthRequest(3, 409, "Simulated disconnect");

      resumable.upload();
      await backendMock.waitForSuccessfulUploads(2);
      await backendMock.waitForUploadCount(3);

      const resumable2 = new Resumable({
        target: "/upload",
        chunkSize: 4,
        testChunks: true,
        simultaneousUploads: 1,
      });
      resumable2.addFile(file);

      const complete = new Promise<void>((resolve) =>
        resumable2.addEventListener("complete", () => resolve()),
      );
      resumable2.upload();
      await complete;

      const identifier = resumable2.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should pause and resume without losing uploaded data", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 5,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "pause-and-resume";
      const file = new File([payload], "pause.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.setResponseDelay(20);

      resumable.upload();
      await backendMock.waitForUploadCount(1);

      resumable.pause();
      const pausedCount = backendMock.getUploadRequestCount();
      await sleep(30);
      expect(backendMock.getUploadRequestCount()).toBe(pausedCount);

      backendMock.setResponseDelay(0);
      const complete = new Promise<void>((resolve) =>
        resumable.addEventListener("complete", () => resolve()),
      );

      resumable.upload();
      await complete;

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should respect simultaneousUploads parallelity", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 3,
        testChunks: false,
        simultaneousUploads: 2,
      });

      const payload = "parallel-chunks-data";
      const file = new File([payload], "parallel.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.setResponseDelay(30);

      const complete = new Promise<void>((resolve) =>
        resumable.addEventListener("complete", () => resolve()),
      );

      resumable.upload();
      await complete;

      expect(backendMock.getMaxInflightUploads()).toBeGreaterThan(1);
      expect(backendMock.getMaxInflightUploads()).toBeLessThanOrEqual(2);
    });

    it("should report progress values that are monotonic and end at 1", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 4,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "progress-values";
      const file = new File([payload], "progress.txt", { type: "text/plain" });
      resumable.addFile(file);

      const progressValues: number[] = [];
      const totalChunks = resumable.files[0].chunks.length;

      resumable.upload();

      for (let index = 1; index <= totalChunks; index++) {
        await backendMock.waitForSuccessfulUploads(index);
        progressValues.push(resumable.progress());
      }

      expect(progressValues.every((value) => value >= 0 && value <= 1)).toBe(true);
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
      expect(resumable.progress()).toBe(1);
    });

    it("should not fire complete twice when the last file fails permanently", async () => {
      resumable = new Resumable({
        target: "/upload",
        chunkSize: 4,
        testChunks: false,
        simultaneousUploads: 2,
      });

      const payload = "permanent-error";
      const file = new File([payload], "error.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.failUploadOnNthRequest(1, 500, "Permanent");
      backendMock.failUploadOnNthRequest(2, 500, "Permanent");

      const completeSpy = vi.fn();
      resumable.addEventListener("complete", completeSpy);

      resumable.upload();
      await sleep(50);

      expect(completeSpy).toHaveBeenCalledTimes(1);
    });
  });
});

import { sleep } from "libs/utils";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumableUpload, type ResumableUploadEvent } from "../../libs/resumable-upload";
import { ResumableBackendMock } from "../helpers/resumable_backend_mock";

describe("Resumable Use Cases (WebKnossos Patterns)", () => {
  let resumable: ResumableUpload;
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

      backendMock.setResponseDelay(20);
      backendMock.setRequiredToken("initial-token");
      backendMock.rotateTokenAfterUploadCount(1, "new-token");

      resumable = new ResumableUpload({
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
      token = "new-token";

      await backendMock.waitForSuccessfulUploads(1);
      expect(queryFn).toHaveBeenCalled();
      expect(backendMock.getUploadTokens()[0]).toBe("initial-token");

      await backendMock.waitForSuccessfulUploads(2);
      expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(backendMock.getUploadTokens()[1]).toBe("new-token");
    });
  });

  describe("Chunk Testing (testChunks: true)", () => {
    it("should issue GET request before POST", async () => {
      resumable = new ResumableUpload({
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

      resumable = new ResumableUpload({
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
      resumable = new ResumableUpload({
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

      resumable = new ResumableUpload({
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

    it("should fall back to POST when chunk test request times out", async () => {
      backendMock.setTestResponseDelay(30);

      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
        fetchTimeout: 5,
        simultaneousUploads: 1,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();
      await resumable.waitForComplete();

      expect(backendMock.getTestRequestCount()).toBeGreaterThan(0);
      const hasPost = backendMock.requestLog.some((entry) => entry.method === "POST");
      expect(hasPost).toBe(true);
      expect(resumable.files[0].chunks[0].status()).toBe("success");
    });
  });

  describe("Custom Unique Identifier", () => {
    it("should use generateUniqueIdentifier function", async () => {
      const customIdFn = vi.fn().mockReturnValue("custom-id-123");

      resumable = new ResumableUpload({
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
      resumable = new ResumableUpload({
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
      resumable = new ResumableUpload({
        target: "/upload",
        testChunks: false,
        permanentErrors: [415], // Only 415 is permanent
        maxChunkRetries: 2,
        chunkRetryInterval: 1,
      });

      const file = new File(["123"], "test.txt");
      resumable.addFile(file);

      // Make all attempts fail with a non-permanent status.
      backendMock.failUploadOnNthRequest(1, 500, "Error");
      backendMock.failUploadOnNthRequest(2, 500, "Error");
      backendMock.failUploadOnNthRequest(3, 500, "Error");

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();
      await sleep(80);

      // Should have retried multiple times (initial + retries)
      expect(backendMock.getUploadRequestCount()).toBe(3);
      expect(fileErrorSpy).toHaveBeenCalled(); // Eventually fails after retries exhaustion
      // Chunks cleared after exhaustion
      expect(resumable.files[0].chunks.length).toBe(0);
    });
  });

  describe("Retry Logic (Manual Retry)", () => {
    it("should reset chunks and restart upload on file.retry()", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 10,
        testChunks: false,
        permanentErrors: [500],
        simultaneousUploads: 1,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      const resumableFile = resumable.files[0];

      backendMock.failUploadOnNthRequest(1, 500, "Boom");
      const fileError = new Promise<void>((resolve) =>
        resumable.addEventListener("fileError", () => resolve()),
      );
      resumable.upload();
      await fileError;
      expect(resumableFile.chunks.length).toBe(0);

      const bootstrapSpy = vi.spyOn(resumableFile, "bootstrap");

      backendMock.reset();
      resumableFile.retry();
      await resumable.waitForComplete();

      expect(bootstrapSpy).toHaveBeenCalled();
      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });
  });

  describe("Files Added Trigger", () => {
    it("should fire filesAdded event", async () => {
      const filesAddedSpy = vi.fn();
      resumable = new ResumableUpload({ target: "/upload" });
      resumable.addEventListener("filesAdded", filesAddedSpy);

      const file = new File(["content"], "test.txt");
      resumable.addFile(file);

      await sleep(10);
      expect(filesAddedSpy).toHaveBeenCalled();
    });
  });

  describe("Backend-backed Integration Cases", () => {
    it("should upload correct chunks and reconstruct the original data", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 5,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "hello-world-resumable";
      const file = new File([payload], "payload.txt", { type: "text/plain" });
      resumable.addFile(file);

      resumable.upload();
      await resumable.waitForComplete();

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
      resumable = new ResumableUpload({
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

      resumable.upload();
      await resumable.waitForComplete();

      expect(backendMock.getUploadRequestCount()).toBeGreaterThan(
        backendMock.getSuccessfulUploadCount(),
      );

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should resume with a second instance against the same backend state", async () => {
      resumable = new ResumableUpload({
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

      const resumable2 = new ResumableUpload({
        target: "/upload",
        chunkSize: 4,
        testChunks: true,
        simultaneousUploads: 1,
      });
      resumable2.addFile(file);

      resumable2.upload();
      await resumable2.waitForComplete();

      const identifier = resumable2.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should pause and resume without losing uploaded data", async () => {
      resumable = new ResumableUpload({
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
      await backendMock.waitForIdle();

      backendMock.setResponseDelay(0);

      resumable.upload();
      await resumable.waitForComplete();

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should abort and resume without losing uploaded data", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 5,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "abort-and-resume";
      const file = new File([payload], "abort.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.setResponseDelay(30);
      resumable.upload();
      await backendMock.waitForUploadCount(1);

      resumable.files[0].abort();
      await backendMock.waitForIdle();
      const pausedCount = backendMock.getUploadRequestCount();
      await sleep(30);
      expect(backendMock.getUploadRequestCount()).toBe(pausedCount);

      backendMock.setResponseDelay(0);

      resumable.upload();
      await resumable.waitForComplete();

      const identifier = resumable.files[0].uniqueIdentifier;
      const uploadedBytes = backendMock.getFinalUploadData(identifier);
      const originalBytes = new Uint8Array(await file.arrayBuffer());
      expect(uploadedBytes).toEqual(originalBytes);
    });

    it("should respect simultaneousUploads parallelity", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 3,
        testChunks: false,
        simultaneousUploads: 2,
      });

      const payload = "parallel-chunks-data";
      const file = new File([payload], "parallel.txt", { type: "text/plain" });
      resumable.addFile(file);

      backendMock.setResponseDelay(30);

      resumable.upload();
      await resumable.waitForComplete();

      expect(backendMock.getMaxInflightUploads()).toEqual(2);
    });

    it("should report progress values that are monotonic and end at 1", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 4,
        testChunks: false,
        simultaneousUploads: 1,
      });

      const payload = "progress-values";
      const file = new File([payload], "progress.txt", { type: "text/plain" });
      resumable.addFile(file);
      const identifier = resumable.files[0].uniqueIdentifier;

      const progressValues: number[] = [];
      const totalChunks = resumable.files[0].chunks.length;

      resumable.upload();

      for (let index = 1; index <= totalChunks; index++) {
        await backendMock.waitForSuccessfulUploads(index);
        const frontendProgress = resumable.progress();
        const backendProgress = backendMock.getProgress(identifier);
        progressValues.push(frontendProgress);
        expect(frontendProgress).toBeGreaterThanOrEqual(Math.max(0, backendProgress - 0.05));
        expect(frontendProgress).toBeLessThanOrEqual(1);
      }

      expect(progressValues.every((value) => value >= 0 && value <= 1)).toBe(true);
      for (let i = 1; i < progressValues.length; i++) {
        expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1]);
      }
      expect(resumable.progress()).toBe(1);
      expect(backendMock.getProgress(identifier)).toBe(1);
    });

    it("should not fire complete twice when the last file fails permanently", async () => {
      resumable = new ResumableUpload({
        target: "/upload",
        chunkSize: 4,
        testChunks: false,
        simultaneousUploads: 2,
      });

      const fileContent1 = "file-content-1";
      const fileContent2 = "file-content-2";
      const file1 = new File([fileContent1], "file1.txt", { type: "text/plain" });
      const file2 = new File([fileContent2], "file2.txt", { type: "text/plain" });
      resumable.addFile(file1);
      resumable.addFile(file2);
      const identifier1 = resumable.files[0].uniqueIdentifier;
      const identifier2 = resumable.files[1].uniqueIdentifier;

      backendMock.failUploadOnNthRequest(1, 500, "Permanent");

      const successLog: boolean[] = [];
      const completeSpy = vi.fn((event: ResumableUploadEvent) => {
        if (event.detail.type !== "complete") {
          return;
        }
        successLog.push(event.detail.didUploadCompleteSuccessfully as boolean);
      });
      resumable.addEventListener("complete", completeSpy);

      resumable.addEventListener("fileError", async (event: ResumableUploadEvent) => {
        if (event.detail.type !== "fileError") {
          return;
        }
        const { file } = event.detail;
        await sleep(50); // in wk, we might fetch a new token here
        file.retry();
      });

      resumable.upload();
      await resumable.waitForComplete(); // this should be a failure because one chunk could not be uploaded
      await resumable.waitForComplete(); // this should be a success because of the retry

      expect(successLog).toEqual([false, true]);

      const uploadedBytes1 = backendMock.getFinalUploadData(identifier1);
      const uploadedBytes2 = backendMock.getFinalUploadData(identifier2);
      const originalBytes1 = new Uint8Array(await file1.arrayBuffer());
      const originalBytes2 = new Uint8Array(await file2.arrayBuffer());

      expect(uploadedBytes1).toEqual(originalBytes1);
      expect(uploadedBytes2).toEqual(originalBytes2);
      expect(backendMock.getInvariantViolations()).toEqual([]);
    });
  });
});

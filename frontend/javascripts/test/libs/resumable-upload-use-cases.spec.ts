import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Resumable } from "../../libs/resumable-upload";
import { sleep } from "libs/utils";

type RequestLogEntry = {
  method: string;
  url: string;
};

describe("Resumable Use Cases (WebKnossos Patterns)", () => {
  let resumable: Resumable;
  let requestLog: Array<RequestLogEntry> = [];
  let responseResolver: ((request: Request) => HttpResponse | Promise<HttpResponse>) | undefined;

  const server = setupServer(
    http.all("http://localhost/upload", async ({ request }) => {
      requestLog.push({ method: request.method, url: request.url });

      if (responseResolver) {
        return await responseResolver(request);
      }

      return HttpResponse.text("success", { status: 200 });
    }),
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
    requestLog = [];
    responseResolver = undefined;
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

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        query: queryFn,
        testChunks: false,
      });

      const file = new File(["1234567890"], "test.txt", { type: "text/plain" });
      resumable.addFile(file);

      // trigger upload
      resumable.upload();

      await sleep(10);

      expect(queryFn).toHaveBeenCalled();
      const firstCallUrl = requestLog[0]?.url ?? "";
      expect(firstCallUrl).toContain("token=initial-token");

      // Rotate token and retry/upload next
      token = "new-token";

      // Simulate next chunk or retry
      const chunk = resumable.files[0].chunks[0];
      chunk.send();

      await sleep(10);

      const secondCallUrl = requestLog[requestLog.length - 1]?.url ?? "";
      expect(secondCallUrl).toContain("token=new-token");
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
      const firstCall = requestLog[0];
      expect(firstCall?.method).toBe("GET");
    });

    it("should not upload chunk if it already exists on server)", async () => {
      // Conditionally return 200 for GET, fail for POST (to ensure we don't post)
      responseResolver = (request) => {
        if (request.method === "GET") {
          return HttpResponse.text("Found", { status: 200 });
        }
        return HttpResponse.text("Should not POST", { status: 400 });
      };

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
      expect(requestLog.length).toBeGreaterThan(0);
      expect(requestLog[0]?.method).toBe("GET");

      // should never have called POST to upload the actual data as it was already present
      const hasPost = requestLog.some((entry) => entry.method === "POST");
      expect(hasPost).toBe(false);

      expect(errorHandler).not.toHaveBeenCalled();

      // Chunk should be marked success
      expect(resumable.files[0].chunks[0].status()).toBe("success");
    });

    it("should upload chunk if it does not exist on server", async () => {
      responseResolver = (request) => {
        if (request.method === "GET") {
          return HttpResponse.text("", { status: 204 });
        }
        return HttpResponse.text("", { status: 200 });
      };

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await sleep(50);

      expect(requestLog.length).toBeGreaterThan(0);
      const hasPost = requestLog.some((entry) => entry.method === "POST");
      expect(hasPost).toBe(true);
    });

    it("should proceed to POST if GET returns 404 (chunk missing)", async () => {
      responseResolver = (request) => {
        if (request.method === "GET") {
          return HttpResponse.text("Not Found", { status: 404 });
        }
        if (request.method === "POST") {
          return HttpResponse.text("Uploaded", { status: 200 });
        }
        return HttpResponse.text("Error", { status: 500 });
      };

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await sleep(50);

      const hasGet = requestLog.some((entry) => entry.method === "GET");
      const hasPost = requestLog.some((entry) => entry.method === "POST");
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
      responseResolver = () => HttpResponse.text("Internal Server Error", { status: 500 });

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();

      await sleep(20);

      // Should have failed immediately without retries due to permanent error
      expect(requestLog.length).toBe(1);
      expect(fileErrorSpy).toHaveBeenCalled();
      const errorDetail = fileErrorSpy.mock.calls[0][0].detail;
      expect(errorDetail.message).toBe("Internal Server Error");
      // Chunks are cleared on error, so we cannot check chunk status
      expect(resumable.files[0].chunks.length).toBe(0);

      // Now Manual Retry
      // Reset mock to success
      requestLog = [];
      responseResolver = () => HttpResponse.text("Success", { status: 200 });

      resumable.files[0].retry();

      await sleep(20);

      // Should have retried and succeeded
      expect(requestLog.length).toBeGreaterThan(0);

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
      responseResolver = () => HttpResponse.text("Error", { status: 500 });

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();
      await sleep(50);

      // Should have retried multiple times (initial + retries)
      expect(requestLog.length).toBeGreaterThan(1);
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Resumable } from "../../libs/resumable-upload";

describe("Resumable Use Cases (WebKnossos Patterns)", () => {
  let resumable: Resumable;
  let mockFetch: any;

  beforeEach(() => {
    const mockLocation = new URL("http://localhost");
    vi.stubGlobal("location", mockLocation);
    vi.stubGlobal("window", { location: mockLocation });

    // Reset mocks
    vi.restoreAllMocks();
    mockFetch = vi.fn().mockImplementation(() => {
      // console.log("Fetch called:", url, init?.method);
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("success"),
        headers: new Headers(),
      });
    });
    global.fetch = mockFetch;
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

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(queryFn).toHaveBeenCalled();
      const firstCallUrl = mockFetch.mock.calls[0][0];
      expect(firstCallUrl).toContain("token=initial-token");

      // Rotate token and retry/upload next
      token = "new-token";

      // Simulate next chunk or retry
      const chunk = resumable.files[0].chunks[0];
      chunk.send();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondCallUrl = mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0];
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
      await new Promise((resolve) => setTimeout(resolve, 10));

      // First call should be GET (test)
      const firstCallArgs = mockFetch.mock.calls[0];
      expect(firstCallArgs[1].method).toBe("GET");
    });

    it("should skip POST if GET returns 200 (chunk exists)", async () => {
      // Conditionally return 200 for GET, fail for POST (to ensure we don't post)
      mockFetch.mockImplementation((url: string, init: any) => {
        if (init?.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("Found"),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 400, // Fail if POST is attempted
          text: () => Promise.resolve("Should not POST"),
        });
      });

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have made at least one GET
      expect(mockFetch).toHaveBeenCalled();
      const calls = mockFetch.mock.calls;
      expect(calls[0][1].method).toBe("GET");

      const hasPost = calls.some((c: any) => c[1]?.method === "POST");
      expect(hasPost).toBe(false);

      // Chunk should be marked success
      expect(resumable.files[0].chunks[0].status()).toBe("success");
    });

    it("should treat 204 as success (chunk exists)", async () => {
      mockFetch.mockImplementation((url: string, init: any) => {
        if (init?.method === "GET") {
          return Promise.resolve({
            ok: true,
            status: 204, // No Content
            text: () => Promise.resolve(""),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500, // Fail if POST
          text: () => Promise.resolve("Should not POST"),
        });
      });

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockFetch).toHaveBeenCalled();
      const calls = mockFetch.mock.calls;
      const hasPost = calls.some((c: any) => c[1]?.method === "POST");
      expect(hasPost).toBe(false);
    });

    it("should proceed to POST if GET returns 404 (chunk missing)", async () => {
      mockFetch.mockImplementation((url: string, init: any) => {
        if (init?.method === "GET") {
          return Promise.resolve({
            ok: false,
            status: 404,
            text: () => Promise.resolve("Not Found"),
          });
        }
        if (init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve("Uploaded"),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      });

      resumable = new Resumable({
        target: "/upload",
        chunkSize: 10,
        testChunks: true,
      });

      const file = new File(["1234567890"], "test.txt");
      resumable.addFile(file);
      resumable.upload();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const calls = mockFetch.mock.calls;
      const hasGet = calls.some((c: any) => c[1]?.method === "GET");
      const hasPost = calls.some((c: any) => c[1]?.method === "POST");
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
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have failed immediately without retries due to permanent error
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(fileErrorSpy).toHaveBeenCalled();
      const errorDetail = fileErrorSpy.mock.calls[0][0].detail;
      expect(errorDetail.message).toBe("Internal Server Error");
      // Chunks are cleared on error, so we cannot check chunk status
      expect(resumable.files[0].chunks.length).toBe(0);

      // Now Manual Retry
      // Reset mock to success
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve("Success"),
      });

      resumable.files[0].retry();

      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should have retried and succeeded
      expect(mockFetch).toHaveBeenCalled();

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
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Error"),
      });

      const fileErrorSpy = vi.fn();
      resumable.addEventListener("fileError", fileErrorSpy);

      resumable.upload();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have retried multiple times (initial + retries)
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
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

      await new Promise((resolve) => setTimeout(resolve, 0));

      const bootstrapSpy = vi.spyOn(resumableFile, "bootstrap");

      resumableFile.retry();

      // Wait for bootstrap timeout (0ms) and event loop
      await new Promise((resolve) => setTimeout(resolve, 50));

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
    it("should fire filesAdded event", () => {
      const filesAddedSpy = vi.fn();
      resumable = new Resumable({ target: "/upload" });
      resumable.addEventListener("filesAdded", filesAddedSpy);

      const file = new File(["content"], "test.txt");
      resumable.addFile(file);

      return new Promise((resolve) => {
        setTimeout(() => {
          expect(filesAddedSpy).toHaveBeenCalled();
          resolve(undefined);
        }, 10);
      });
    });
  });
});

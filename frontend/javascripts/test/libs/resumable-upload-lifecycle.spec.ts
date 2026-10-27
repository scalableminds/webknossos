import { ResumableUpload } from "libs/resumable_upload/resumable_upload";
import { sleep } from "libs/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CapturedRequest = {
  method: string;
  chunkNumber: number;
  signal: AbortSignal;
  settled: boolean;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};

// A fetch stub whose requests stay pending until the test settles them, so
// that intermediate states (probe in flight, retry timer pending) are observable.
function installControllableFetch() {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const chunkNumber = Number(new URL(url).searchParams.get("resumableChunkNumber"));
      return new Promise<Response>((resolve, reject) => {
        const request: CapturedRequest = {
          method: init.method ?? "GET",
          chunkNumber,
          signal: init.signal as AbortSignal,
          settled: false,
          resolve: (response) => {
            request.settled = true;
            resolve(response);
          },
          reject: (error) => {
            request.settled = true;
            reject(error);
          },
        };
        requests.push(request);
        init.signal?.addEventListener("abort", () => {
          request.reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }),
  );
  return requests;
}

const activeRequests = (requests: CapturedRequest[]) => requests.filter((r) => !r.settled);

function createUpload(options: { testChunks: boolean; chunkRetryInterval?: number }) {
  const resumable = new ResumableUpload({
    target: "/upload",
    chunkSize: 10,
    simultaneousUploads: 3,
    ...options,
  });
  // 6 chunks of 10 bytes each
  resumable.addFile(new File(["x".repeat(60)], "test.txt"));
  return resumable;
}

beforeEach(() => {
  const mockLocation = new URL("http://localhost");
  vi.stubGlobal("location", mockLocation);
  vi.stubGlobal("window", { location: mockLocation });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Resumable chunk lifecycle", () => {
  describe("chunk probes (testChunks: true)", () => {
    it("should probe distinct chunks when starting the upload", async () => {
      const requests = installControllableFetch();
      const resumable = createUpload({ testChunks: true });
      await sleep(0);

      resumable.upload();
      await sleep(0);

      expect(requests.map((r) => [r.method, r.chunkNumber])).toEqual([
        ["GET", 1],
        ["GET", 2],
        ["GET", 3],
      ]);
      expect(resumable.isUploading()).toBe(true);
    });

    it("should not exceed simultaneousUploads when probes turn into uploads", async () => {
      const requests = installControllableFetch();
      const resumable = createUpload({ testChunks: true });
      await sleep(0);

      resumable.upload();
      await sleep(0);
      // Server reports none of the chunks exists yet
      for (const probe of [...requests]) probe.resolve(new Response(null, { status: 204 }));
      await sleep(0);

      expect(activeRequests(requests).map((r) => [r.method, r.chunkNumber])).toEqual([
        ["POST", 1],
        ["POST", 2],
        ["POST", 3],
      ]);
    });

    it("should abort pending probes when pausing", async () => {
      const requests = installControllableFetch();
      const resumable = createUpload({ testChunks: true });
      await sleep(0);

      resumable.upload();
      await sleep(0);
      expect(requests.length).toBeGreaterThan(0);

      resumable.pause();

      expect(requests.every((r) => r.signal.aborted)).toBe(true);
      expect(resumable.isUploading()).toBe(false);
    });

    it("should abort pending probes when cancelling", async () => {
      const requests = installControllableFetch();
      const resumable = createUpload({ testChunks: true });
      await sleep(0);

      resumable.upload();
      await sleep(0);
      resumable.cancel();

      expect(requests.every((r) => r.signal.aborted)).toBe(true);
    });
  });

  it("should mark a chunk as failed instead of leaving it uploading when preparing a request throws", async () => {
    const requests = installControllableFetch();
    const resumable = new ResumableUpload({
      target: "/upload",
      chunkSize: 10,
      simultaneousUploads: 3,
      testChunks: true,
      query: () => {
        throw new Error("No token");
      },
    });
    resumable.addFile(new File(["x".repeat(60)], "test.txt"));
    const fileErrorSpy = vi.fn();
    resumable.addEventListener("fileError", fileErrorSpy);
    await sleep(0);

    resumable.upload();
    await sleep(0);

    expect(requests).toEqual([]);
    expect(resumable.isUploading()).toBe(false);
    expect(fileErrorSpy).toHaveBeenCalled();
  });

  it("should keep retrying network errors beyond maxChunkRetries", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(() =>
      ++attempts <= 5
        ? Promise.reject(new TypeError("Network failure"))
        : Promise.resolve(new Response("ok")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const resumable = new ResumableUpload({
      target: "/upload",
      chunkSize: 10,
      testChunks: false,
      maxChunkRetries: 2,
      chunkRetryInterval: 1,
    });
    resumable.addFile(new File(["x".repeat(10)], "test.txt"));
    const fileErrorSpy = vi.fn();
    resumable.addEventListener("fileError", fileErrorSpy);
    const fileSuccess = new Promise<void>((resolve) =>
      resumable.addEventListener("fileSuccess", () => resolve()),
    );
    await sleep(0);

    resumable.upload();

    await fileSuccess;
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fileErrorSpy).not.toHaveBeenCalled();
  });

  it("should not leave abort listeners behind after waiting for retries", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        ++attempts <= 5
          ? Promise.reject(new TypeError("Network failure"))
          : Promise.resolve(new Response("ok")),
      ),
    );
    const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener");
    const removeSpy = vi.spyOn(EventTarget.prototype, "removeEventListener");
    const abortListenerCount = (spy: typeof addSpy | typeof removeSpy) =>
      spy.mock.calls.filter(([type]) => type === "abort").length;
    const resumable = new ResumableUpload({
      target: "/upload",
      chunkSize: 10,
      testChunks: false,
      chunkRetryInterval: 1,
    });
    resumable.addFile(new File(["x".repeat(10)], "test.txt"));
    const fileSuccess = new Promise<void>((resolve) =>
      resumable.addEventListener("fileSuccess", () => resolve()),
    );
    await sleep(0);

    try {
      resumable.upload();
      await fileSuccess;

      // One listener per request and one per retry wait, each removed again.
      expect(abortListenerCount(addSpy)).toBe(6 + 5);
      expect(abortListenerCount(removeSpy)).toBe(abortListenerCount(addSpy));
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it("should not resume a paused upload when retrying a failed file", async () => {
    const requests = installControllableFetch();
    const resumable = createUpload({ testChunks: false });
    await sleep(0);
    const file = resumable.files[0];

    resumable.upload();
    await sleep(0);
    // A permanent error fails the file, then the user pauses, e.g. in the cancel dialog.
    requests[0].resolve(new Response("Forbidden", { status: 403 }));
    await sleep(0);
    resumable.pause();
    const requestCountBeforeRetry = requests.length;

    file.retry();
    await sleep(10);

    expect(file.isPaused()).toBe(true);
    expect(requests.length).toBe(requestCountBeforeRetry);

    resumable.upload();
    await sleep(0);

    expect(activeRequests(requests).map((r) => r.chunkNumber)).toEqual([1, 2, 3]);
  });

  describe("retry timers", () => {
    const RETRY_INTERVAL = 30;

    async function startAndFailFirstUpload() {
      const requests = installControllableFetch();
      const resumable = createUpload({ testChunks: false, chunkRetryInterval: RETRY_INTERVAL });
      await sleep(0);

      resumable.upload();
      await sleep(0);
      requests[0].reject(new TypeError("Network failure"));
      await sleep(0);
      const chunk = resumable.files[0].chunks[0];
      expect(chunk.pendingRetry).toBe(true);
      return { requests, resumable, chunk };
    }

    it("should not restart a chunk after pausing", async () => {
      const { requests, resumable } = await startAndFailFirstUpload();
      const requestCountBeforePause = requests.length;

      resumable.pause();
      await sleep(RETRY_INTERVAL * 3);

      expect(resumable.files[0].isPaused()).toBe(true);
      expect(requests.length).toBe(requestCountBeforePause);
      expect(activeRequests(requests)).toEqual([]);
    });

    it("should not restart a chunk after cancelling", async () => {
      const { requests, resumable } = await startAndFailFirstUpload();
      const requestCountBeforeCancel = requests.length;

      resumable.cancel();
      await sleep(RETRY_INTERVAL * 3);

      expect(resumable.files).toEqual([]);
      expect(requests.length).toBe(requestCountBeforeCancel);
    });

    it("should upload the chunk again once resumed", async () => {
      const { requests, resumable } = await startAndFailFirstUpload();

      resumable.pause();
      resumable.upload();
      await sleep(RETRY_INTERVAL * 3);

      const activeChunks = activeRequests(requests).map((r) => r.chunkNumber);
      expect(activeChunks.sort()).toEqual([1, 2, 3]);
    });

    it("should not restart a stale chunk after retrying the file", async () => {
      const { requests, resumable, chunk: staleChunk } = await startAndFailFirstUpload();
      const file = resumable.files[0];

      resumable.pause();
      file.retry();
      await sleep(RETRY_INTERVAL * 3);

      expect(file.chunks).not.toContain(staleChunk);
      expect(staleChunk.pendingRetry).toBe(false);
      // Only the rebuilt chunks may be uploading, at most once each
      const activeChunks = activeRequests(requests).map((r) => r.chunkNumber);
      expect(new Set(activeChunks).size).toBe(activeChunks.length);
      expect(activeChunks.length).toBeLessThanOrEqual(3);
    });
  });
});

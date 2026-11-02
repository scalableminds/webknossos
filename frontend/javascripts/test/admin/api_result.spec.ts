import { requestResult } from "admin/api/api_result";
import { describe, expect, it, vi } from "vitest";

describe("requestResult", () => {
  it("should retry without limit if retries is infinite", async () => {
    let calls = 0;
    const requester = vi.fn(async () => {
      calls++;
      if (calls <= 10) {
        throw new TypeError("Failed to fetch");
      }
      return "value";
    });

    const result = await requestResult(
      requester,
      { showErrorToast: false },
      { retries: Number.POSITIVE_INFINITY, initialDelayMs: 1, backoffFactor: 2, maxDelayMs: 4 },
    );

    expect(result).toEqual({ ok: true, value: "value" });
    expect(requester).toHaveBeenCalledTimes(11);
  });

  it("should not retry errors that are not retryable, even if retries is infinite", async () => {
    const cause = { status: 403, messages: [{ error: "Forbidden" }] };
    const requester = vi.fn(async () => {
      throw cause;
    });

    const result = await requestResult(
      requester,
      { showErrorToast: false },
      { retries: Number.POSITIVE_INFINITY, initialDelayMs: 1 },
    );

    expect(result.ok).toBe(false);
    expect(requester).toHaveBeenCalledTimes(1);
  });
  it("should stop retrying when the signal is aborted", async () => {
    const abortController = new AbortController();
    const requester = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const resultPromise = requestResult(
      requester,
      { showErrorToast: false, signal: abortController.signal },
      { retries: Number.POSITIVE_INFINITY, initialDelayMs: 60 * 1000 },
    );
    // Abort while requestResult waits for the first retry.
    await vi.waitFor(() => expect(requester).toHaveBeenCalledTimes(1));
    abortController.abort();

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("abort");
    expect(requester).toHaveBeenCalledTimes(1);
  });
});

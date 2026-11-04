import { requestResult } from "admin/api/api_result";
import { registerHasActiveUserFn } from "libs/handle_request_error_helper";
import Toast, { showToastOnce } from "libs/toast";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("libs/toast", () => ({
  default: {
    error: vi.fn(),
    messages: vi.fn(),
  },
  showToastOnce: vi.fn(),
}));

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

  describe("error toasts for 401 responses", () => {
    const messages = [{ error: "You are not authorized to view this resource. Please log in." }];
    const failWith401 = async () => {
      throw { status: 401, messages };
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should show only the session expired toast if a user was logged in", async () => {
      registerHasActiveUserFn(() => true);

      const result = await requestResult(failWith401);

      expect(result.ok).toBe(false);
      expect(showToastOnce).toHaveBeenCalledTimes(1);
      expect(Toast.messages).not.toHaveBeenCalled();
      expect(Toast.error).not.toHaveBeenCalled();
    });

    it("should show the server messages if no user was logged in", async () => {
      registerHasActiveUserFn(() => false);

      await requestResult(failWith401);

      expect(showToastOnce).not.toHaveBeenCalled();
      expect(Toast.messages).toHaveBeenCalledWith(messages);
    });
  });
});

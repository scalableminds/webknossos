// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import { sleep } from "libs/utils";
import type { APIUpdateActionBatch } from "types/api_types";
import { restartSagaAction } from "viewer/model/actions/actions";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerUpdateAction = APIUpdateActionBatch["value"][number];

function getNewerVersionWithAction(action: ServerUpdateAction) {
  const batches: APIUpdateActionBatch[] = [
    { version: Store.getState().annotation.version + 1, value: [action] },
  ];
  return { ok: true as const, value: batches };
}

describe("Reporting of failed rebasing", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    vi.mocked(ErrorHandling.notifyWithPrefix).mockClear();
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should report the reason if a newer version cannot be applied", async (context: WebknossosTestContext) => {
    // Legacy actions cannot be applied by the rebasing logic.
    context.mocks.getUpdateActionLog.mockResolvedValueOnce(
      getNewerVersionWithAction({
        name: "updateSegmentGroups",
        value: { segmentGroups: [], actionTracingId: "volumeTracingId" },
      } as unknown as ServerUpdateAction),
    );

    // Not awaited on purpose: if rebasing fails, the promise is never resolved.
    dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await vi.waitFor(() => expect(ErrorHandling.notifyWithPrefix).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    const [error, prefix, params, severity] = vi.mocked(ErrorHandling.notifyWithPrefix).mock
      .calls[0];
    expect(prefix).toBe("Rebasing failed: ");
    expect((error as Error).message).toBe("Cannot apply legacy action");
    expect(params).toMatchObject({
      reason: "Cannot apply legacy action",
      actionName: "updateSegmentGroups",
      phase: "applyMissingUpdateActions",
      collaborationMode: "Concurrent",
      isCallerWaiting: true,
    });
    expect(severity).toBe("error");
  });

  it("should report a foreign revert as a warning", async (context: WebknossosTestContext) => {
    context.mocks.getUpdateActionLog.mockResolvedValueOnce(
      getNewerVersionWithAction({
        name: "revertToVersion",
        value: { sourceVersion: 1 },
      } as unknown as ServerUpdateAction),
    );

    // Not awaited on purpose: if rebasing fails, the promise is never resolved.
    dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await vi.waitFor(() => expect(ErrorHandling.notifyWithPrefix).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    const [error, prefix, params, severity] = vi.mocked(ErrorHandling.notifyWithPrefix).mock
      .calls[0];
    expect(prefix).toBe("Rebasing failed: ");
    expect((error as Error).message).toBe("Annotation was reverted by another user");
    expect(params).toMatchObject({ reason: "Annotation was reverted by another user" });
    expect(severity).toBe("warning");
  });

  it("should retry fetching the missing update actions until the server is back", async (context: WebknossosTestContext) => {
    // Use the real getUpdateActionLog (including its retries) and let the underlying
    // request fail 10 times before it succeeds.
    const { getUpdateActionLog } =
      await vi.importActual<typeof import("admin/rest_api")>("admin/rest_api");
    context.mocks.getUpdateActionLog.mockImplementation(getUpdateActionLog);

    const receiveJSON = vi.mocked(Request.receiveJSON);
    const previousImplementation = receiveJSON.getMockImplementation();
    let updateActionLogRequestCount = 0;
    receiveJSON.mockImplementation(async (url, options) => {
      if (url.includes("/updateActionLog")) {
        updateActionLogRequestCount++;
        if (updateActionLogRequestCount <= 10) {
          throw new TypeError("Failed to fetch");
        }
        return [];
      }
      return previousImplementation?.(url, options);
    });

    let isRequestResolved = false;
    dispatchEnsureHasNewestVersionAsync(Store.dispatch).then(() => {
      isRequestResolved = true;
    });
    await vi.waitFor(() => expect(isRequestResolved).toBe(true), { timeout: 5000 });

    expect(updateActionLogRequestCount).toBe(11);
    expect(hasRootSagaCrashed()).toBe(false);
    expect(ErrorHandling.notifyWithPrefix).not.toHaveBeenCalled();
  });

  it("should report (and not crash) if fetching the missing update actions fails without retry", async (context: WebknossosTestContext) => {
    const cause = { status: 403, messages: [{ error: "Forbidden" }] };
    context.mocks.getUpdateActionLog.mockResolvedValueOnce({
      ok: false,
      error: { kind: "http", status: 403, message: "Forbidden", cause },
    });

    // Not awaited on purpose: if rebasing fails, the promise is never resolved.
    dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await vi.waitFor(() => expect(ErrorHandling.notifyWithPrefix).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });

    expect(hasRootSagaCrashed()).toBe(false);
    const [error, prefix, params, severity] = vi.mocked(ErrorHandling.notifyWithPrefix).mock
      .calls[0];
    expect(error).toBe(cause);
    expect(prefix).toBe("Rebasing failed: ");
    expect(severity).toBe("error");
    expect(params).toMatchObject({
      reason: "Fetching the missing update actions failed",
      errorKind: "http",
      status: 403,
    });
  });

  it("should stop retrying when the sagas are cancelled", async (context: WebknossosTestContext) => {
    const { getUpdateActionLog } =
      await vi.importActual<typeof import("admin/rest_api")>("admin/rest_api");
    context.mocks.getUpdateActionLog.mockImplementation(getUpdateActionLog);

    // The server stays unreachable. Like fetch, the mock rejects with an AbortError if the
    // request was aborted.
    const receiveJSON = vi.mocked(Request.receiveJSON);
    const previousImplementation = receiveJSON.getMockImplementation();
    const signals: Array<AbortSignal | undefined> = [];
    receiveJSON.mockImplementation(async (url, options) => {
      if (url.includes("/updateActionLog")) {
        signals.push(options?.signal);
        if (options?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw new TypeError("Failed to fetch");
      }
      return previousImplementation?.(url, options);
    });

    // Not awaited on purpose: the request is never resolved because the sagas are restarted.
    dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await vi.waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(3), { timeout: 5000 });
    const signal = signals[0];
    expect(signal?.aborted).toBe(false);

    Store.dispatch(restartSagaAction());

    expect(signal?.aborted).toBe(true);
    // At most one more (immediately aborted) attempt is made after the restart.
    const requestCountAfterRestart = signals.length;
    await sleep(200);
    expect(signals.length).toBeLessThanOrEqual(requestCountAfterRestart + 1);
  });
});

// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import ErrorHandling from "libs/error_handling";
import { sleep } from "libs/utils";
import type { APIUpdateActionBatch } from "types/api_types";
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
    vi.mocked(ErrorHandling.notify).mockClear();
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

    void dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await sleep(500);

    expect(ErrorHandling.notify).toHaveBeenCalledTimes(1);
    const [error, params, severity] = vi.mocked(ErrorHandling.notify).mock.calls[0];
    expect((error as Error).message).toBe("Rebasing failed: Cannot apply legacy action");
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

    void dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await sleep(500);

    expect(ErrorHandling.notify).toHaveBeenCalledTimes(1);
    const [error, params, severity] = vi.mocked(ErrorHandling.notify).mock.calls[0];
    expect((error as Error).message).toBe(
      "Rebasing failed: Annotation was reverted by another user",
    );
    expect(params).toMatchObject({ reason: "Annotation was reverted by another user" });
    expect(severity).toBe("warning");
  });

  it("should retry fetching the missing update actions until the server is back", async (context: WebknossosTestContext) => {
    void dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await sleep(200);

    expect(context.mocks.getUpdateActionLog).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      false,
      true,
      {},
      expect.objectContaining({ retries: Number.POSITIVE_INFINITY, maxDelayMs: 60 * 1000 }),
    );
  });

  it("should report (and not crash) if fetching the missing update actions fails without retry", async (context: WebknossosTestContext) => {
    const cause = { status: 403, messages: [{ error: "Forbidden" }] };
    context.mocks.getUpdateActionLog.mockResolvedValueOnce({
      ok: false,
      error: { kind: "http", status: 403, message: "Forbidden", cause },
    });

    void dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await sleep(500);

    expect(hasRootSagaCrashed()).toBe(false);
    expect(ErrorHandling.notifyWithPrefix).toHaveBeenCalledTimes(1);
    const [error, prefix, params] = vi.mocked(ErrorHandling.notifyWithPrefix).mock.calls[0];
    expect(error).toBe(cause);
    expect(prefix).toBe("Rebasing failed: ");
    expect(params).toMatchObject({
      reason: "Fetching the missing update actions failed",
      errorKind: "http",
      status: 403,
    });
  });
});

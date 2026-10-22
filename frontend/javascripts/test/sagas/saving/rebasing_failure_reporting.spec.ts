// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import ErrorHandling from "libs/error_handling";
import type { APIUpdateActionBatch } from "types/api_types";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ServerUpdateAction = APIUpdateActionBatch["value"][number];

function getNewerVersionWithAction(action: ServerUpdateAction): APIUpdateActionBatch[] {
  return [{ version: Store.getState().annotation.version + 1, value: [action] }];
}

describe("Reporting of failed rebasing", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    vi.mocked(ErrorHandling.notify).mockClear();
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
    await vi.waitFor(() => expect(ErrorHandling.notify).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
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

    // Not awaited on purpose: if rebasing fails, the promise is never resolved.
    dispatchEnsureHasNewestVersionAsync(Store.dispatch);
    await vi.waitFor(() => expect(ErrorHandling.notify).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    const [error, params, severity] = vi.mocked(ErrorHandling.notify).mock.calls[0];
    expect((error as Error).message).toBe(
      "Rebasing failed: Annotation was reverted by another user",
    );
    expect(params).toMatchObject({ reason: "Annotation was reverted by another user" });
    expect(severity).toBe("warning");
  });
});

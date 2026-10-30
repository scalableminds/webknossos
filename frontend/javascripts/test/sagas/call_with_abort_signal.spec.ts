import { runSaga } from "redux-saga";
import { callWithAbortSignal } from "viewer/model/sagas/saga_helpers";
import { describe, expect, it } from "vitest";

describe("callWithAbortSignal", () => {
  it("should abort the signal when the saga is cancelled", async () => {
    let receivedSignal: AbortSignal | null = null;
    const task = runSaga({}, function* () {
      yield* callWithAbortSignal((signal) => {
        receivedSignal = signal;
        // Never resolves, so that the saga is still waiting when it gets cancelled.
        return new Promise<void>(() => {});
      });
    });

    expect(receivedSignal!.aborted).toBe(false);
    task.cancel();
    expect(receivedSignal!.aborted).toBe(true);
  });

  it("should not abort the signal when the call finishes normally", async () => {
    let receivedSignal: AbortSignal | null = null;
    const task = runSaga({}, function* () {
      return yield* callWithAbortSignal(async (signal) => {
        receivedSignal = signal;
        return "value";
      });
    });

    expect(await task.toPromise()).toBe("value");
    expect(receivedSignal!.aborted).toBe(false);
  });
});

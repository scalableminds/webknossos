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

  it("should not continue the cancelled saga", async () => {
    let continuedAfterCancel = false;
    const task = runSaga({}, function* () {
      yield* callWithAbortSignal(() => new Promise<void>(() => {}));
      continuedAfterCancel = true;
    });

    task.cancel();
    await task.toPromise();
    expect(continuedAfterCancel).toBe(false);
  });

  it("should return the value of fn", async () => {
    const task = runSaga({}, function* () {
      return yield* callWithAbortSignal(async () => "value");
    });

    expect(await task.toPromise()).toBe("value");
  });
});

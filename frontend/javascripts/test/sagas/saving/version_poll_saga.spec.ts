// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { call, fork, take, takeEvery } from "redux-saga/effects";
import { sleep } from "libs/utils";
import { dispatchEnsureHasNewestVersionAsync } from "viewer/model/actions/save_actions";
import { createOperationContext } from "viewer/model/sagas/operation_context_saga";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Version polling", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should wait (without blocking the event loop) while another operation prevents rebasing", async () => {
    let ensureActionCount = 0;
    let isRequestResolved = false;

    startSaga(function* () {
      yield takeEvery("ENSURE_HAS_NEWEST_VERSION", () => {
        ensureActionCount++;
      });
      // Another operation is running (e.g., a proofreading action or a save request in flight).
      const ctx = yield* createOperationContext({ id: "PROOFREADING" });
      yield fork(function* () {
        yield* ctx.execute(function* () {
          yield take("TEST_FINISH_OPERATION");
        });
      });
      // A request without operation context (like the agglomerate tree loading sends).
      yield call(async () => {
        await dispatchEnsureHasNewestVersionAsync(Store.dispatch);
        isRequestResolved = true;
      });
    });

    // Previously, the request was requeued thousands of times without ever yielding to the
    // event loop, so this sleep would never have returned.
    await sleep(500);
    expect(isRequestResolved).toBe(false);
    // The request is requeued roughly every 100 ms (in tests).
    expect(ensureActionCount).toBeLessThan(20);

    Store.dispatch({ type: "TEST_FINISH_OPERATION" } as any);
    await sleep(500);
    expect(isRequestResolved).toBe(true);
  });
});

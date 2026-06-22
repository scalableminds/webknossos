import Deferred from "libs/async/deferred";
import { sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { actionChannel, delay, put } from "typed-redux-saga";
import {
  dispatchEnsureTracingsWereDiffedToSaveQueueAction,
  saveNowAction,
} from "viewer/model/actions/save_actions";
import { createNodeAction } from "viewer/model/actions/skeletontracing_actions";
import { call, take } from "viewer/model/sagas/effect_generators";
import type { OperationContext } from "viewer/model/sagas/operation_context_saga";
// biome-ignore lint/performance/noNamespaceImport: necessary for mocking
import * as opCtxModule from "viewer/model/sagas/operation_context_saga";
import Store, { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("pushSaveQueueAsync (integration) - 1", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    vi.restoreAllMocks();
    await context.api.tracing.save();
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("retries after a transient network failure", async (context) => {
    const originalImpl = context.mocks.sendSaveRequestWithToken.getMockImplementation()!;
    context.mocks.sendSaveRequestWithToken
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(originalImpl);

    Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));
    Store.dispatch(saveNowAction());

    // Let the failure register, then dispatch a second SAVE_NOW to shortcut
    // the 2-second retry-wait race in sendSaveRequestToServer
    await sleep(50);
    Store.dispatch(saveNowAction());

    // Wait until a successful save has reached the server
    await vi.waitFor(
      () => {
        expect(context.receivedDataPerSaveRequest.length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    // The first call failed; the second succeeded — so the mock was called twice
    expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(2);
  });

  it<WebknossosTestContext>("doesn't save immediately when saveNow actions were buffered before save queue fills up", async (context) => {
    await context.api.tracing.save(); // start with clean queue
    const spy = vi.spyOn(opCtxModule, "getOrCreateOperationContext");

    // When the save queue is empty, multiple saveNow actions will buffer up.
    Store.dispatch(saveNowAction());
    Store.dispatch(saveNowAction());

    // Creating a node will trigger the consumption of the saveNow action channel.
    Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

    let saveCall;
    await vi.waitFor(
      () => {
        saveCall = spy.mock.calls.find(([options]) => (options as any).id === "SAVE");
      },
      { timeout: 200 },
    );

    expect(saveCall).toBeUndefined();
  });

  it<WebknossosTestContext>("uses operationContext if a saveNow action contains one", async (context) => {
    await context.api.tracing.save(); // start with clean queue

    const task = startSaga(function* () {
      const fakeParentCtx = { id: "PROOFREADING" } as unknown as OperationContext;
      const callsBefore = context.mocks.sendSaveRequestWithToken.mock.calls.length;
      const spy = vi.spyOn(opCtxModule, "getOrCreateOperationContext");

      yield put(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

      yield put(saveNowAction(fakeParentCtx));

      // Wait for save (child) operation to be completed.
      yield* take("UNREGISTER_CHILD_OPERATION");
      expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(callsBefore + 1);
      const saveCall = spy.mock.calls.find(([options]) => (options as any).id === "SAVE");
      expect(saveCall![1]).toEqual(fakeParentCtx);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>("does not save when queue is empty, then saves after items arrive (without re-saving immediately in case of multiple saveNow actions)", async (context) => {
    const task = startSaga(function* () {
      context.mocks.sendSaveRequestWithToken.mockImplementation(() => sleep(100));
      const callsBefore = context.mocks.sendSaveRequestWithToken.mock.calls.length;

      // Send multiple saveNow actions on empty queue — should not reach the server
      yield put(saveNowAction());
      yield put(saveNowAction());
      yield put(saveNowAction());
      yield* delay(100);
      expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toBe(callsBefore);

      // Create a node and start saving
      yield put(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

      // Kick off saving twice. The first action will be consumed directly by the draining saga,
      // the second one will be queued into the action channel.
      yield put(saveNowAction());
      yield put(saveNowAction()); // <-- this action should not trigger a second save request.

      // Wait for save operation to be complete.
      yield* take("UNREGISTER_OPERATION");

      // Create another node which needs saving.
      Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

      // Only one save request should have been made (for the first node), as the previous saveNow actions should
      // not have queued up (or rather, they queued up in the buffer but were flushed once the save queue was empty).
      // In other words: We do not want multiple saveNow actions to trigger an immediate save when the state queue
      // filled AFTER a save request completed.
      yield* delay(100);
      expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(callsBefore + 1);

      // Only now, the second node should be saved.
      yield* call(() => context.api.tracing.save());
      expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(callsBefore + 2);
    });
    await task.toPromise();
  });

  it<WebknossosTestContext>(
    "sends multiple save requests on saveNow when save queue was filled during saving",
    { timeout: 10_000 },
    async (context) => {
      const task = startSaga(function* () {
        const savingDoneChannel = yield actionChannel("UNREGISTER_OPERATION");

        // sendSaveRequestWithToken is used for saving and the first request
        // will fulfill the promise in saveRequestStartedDeferred.
        // The first request is finished when saveRequestFinishDeferred is resolved.
        // The second request will go through immediately (we don't need control
        // over that).
        const saveRequestStartedDeferred = new Deferred<void, void>();
        const saveRequestFinishDeferred = new Deferred<void, void>();
        context.mocks.sendSaveRequestWithToken.mockImplementation(() => {
          saveRequestStartedDeferred.resolve();
          return saveRequestFinishDeferred.promise();
        });
        const callsBefore = context.mocks.sendSaveRequestWithToken.mock.calls.length;

        // Create a node and start saving
        yield put(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));
        // Without the following line, the test becomes flaky under high CPU load
        // because the diffing saga is executed only after the saveNow() action
        // is dispatched below. Then, the saveNow action will be ignored because
        // nothing is in the save queue yet.
        yield call(
          dispatchEnsureTracingsWereDiffedToSaveQueueAction,
          Store.dispatch,
          Store.getState().annotation,
        );

        // Kick off saving.
        yield put(saveNowAction());

        // Wait until saving started.
        yield call(() => saveRequestStartedDeferred.promise());

        // Create another node while saving is active.
        Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

        // Let the first save request finish.
        saveRequestFinishDeferred.resolve();

        // Wait for the save operation to complete.
        yield* take(savingDoneChannel);
        // Since the second node was created during the first save request, a second save request
        // should have been made.
        expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(callsBefore + 2);
      });
      await task.toPromise();
    },
  );
});

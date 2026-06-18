import { ColoredLogger, sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { actionChannel, delay, put } from "typed-redux-saga";
import { saveNowAction } from "viewer/model/actions/save_actions";
import { createNodeAction } from "viewer/model/actions/skeletontracing_actions";
import { take } from "viewer/model/sagas/effect_generators";
// biome-ignore lint/performance/noNamespaceImport: necessary for mocking
import Store, { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This test is split off into an own module because it was flaky when all tests were executed
// in parallel (only running it as part of ONE pushSaveQueueAsync.spec was okay). There are probably
// race conditions related to clean up which we simply circumvent by increasing isolation here.
describe("pushSaveQueueAsync (integration) - 2", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    vi.restoreAllMocks();
    await context.api.tracing.save();
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>(
    "sends multiple save requests on saveNow when save queue was filled during saving",
    { timeout: 10_000 },
    async (context) => {
      const task = startSaga(function* () {
        ColoredLogger.logRed("CRITICAL Test Start", performance.now());
        context.mocks.sendSaveRequestWithToken.mockImplementation(() => sleep(100));
        const callsBefore = context.mocks.sendSaveRequestWithToken.mock.calls.length;

        // Create a node and start saving
        yield put(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

        // Kick off saving.
        yield put(saveNowAction());

        // Create another node while saving is active.
        yield delay(50);
        const channel = yield actionChannel("UNREGISTER_OPERATION");
        Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

        ColoredLogger.logRed("wait for UNREGISTER_OPERATION", performance.now());
        // Wait for saving to be done.
        const action = yield* take(channel);
        ColoredLogger.logRed("wait for UNREGISTER_OPERATION DONE", action, performance.now());
        expect(context.mocks.sendSaveRequestWithToken.mock.calls.length).toEqual(callsBefore + 2);
        ColoredLogger.logRed("AFTER EXPECT", performance.now());
      });
      ColoredLogger.logRed("BEFORE toPromise", performance.now());
      await task.toPromise();
      ColoredLogger.logRed("AFTER toPromise", performance.now());
    },
  );
});

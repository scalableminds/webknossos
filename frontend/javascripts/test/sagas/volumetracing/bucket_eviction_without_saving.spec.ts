import { vi, it, expect, beforeEach } from "vitest";
import { waitForCondition } from "libs/utils";
import "test/sagas/saga_integration.mock";
import { __setupOxalis, createBucketResponseFunction } from "test/helpers/apiHelpers";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import dummyUser from "test/fixtures/dummy_user";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";
import { discardSaveQueuesAction } from "oxalis/model/actions/save_actions";

// Mock dependencies
vi.mock("oxalis/model/actions/save_actions", () => ({
  discardSaveQueuesAction: vi.fn(),
}));

beforeEach(async () => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  Store.dispatch(setActiveUserAction(dummyUser));
  await __setupOxalis("volume");
  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

it("Brushing/Tracing should not crash when a lot of buckets are labeled at once without saving in between", async () => {
  // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
  await api.tracing.save();
  // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
  mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
    Uint16Array,
    0,
    0,
  );
  // In earlier versions of webKnossos, buckets could be evicted forcefully when
  // too many were dirty at the same time. This led to a crash in earlier versions.
  // Now, the code should not crash, anymore.
  expect(hasRootSagaCrashed()).toBe(false);
  const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
  await Promise.race([testLabelingManyBuckets(null, false), failedSagaPromise]);
  expect(hasRootSagaCrashed()).toBe(false);
});

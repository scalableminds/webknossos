import { vi, it, expect, beforeEach, describe } from "vitest";
import { waitForCondition } from "libs/utils";
import "test/sagas/saga_integration.mock";
import {
  __setupWebknossos,
  createBucketResponseFunction,
  type SetupWebknossosTestContext,
} from "test/helpers/apiHelpers";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import dummyUser from "test/fixtures/dummy_user";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";
import { discardSaveQueuesAction } from "oxalis/model/actions/save_actions";

// vi.mock("libs/request", () => ({
//   default: {
//     sendJSONReceiveArraybufferWithHeaders: createBucketResponseFunction(Uint16Array, 0, 0),
//   },
// }));

describe("Bucket Eviction With Saving", () => {
  beforeEach<SetupWebknossosTestContext>(async (context) => {
    // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
    Store.dispatch(restartSagaAction());
    Store.dispatch(discardSaveQueuesAction());
    Store.dispatch(setActiveUserAction(dummyUser));

    await __setupWebknossos(context, "volume");

    // Dispatch the wkReadyAction, so the sagas are started
    Store.dispatch(wkReadyAction());
  });

  it<SetupWebknossosTestContext>("Brushing/Tracing should not crash when too many buckets are labeled at once with saving in between", async ({
    api,
    mocks,
  }) => {
    await api.tracing.save();
    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.withImplementation(
      createBucketResponseFunction(Uint16Array, 0, 0),
    );

    expect(hasRootSagaCrashed()).toBe(false);
    const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
    await Promise.race([testLabelingManyBuckets(null, true), failedSagaPromise]);
    expect(hasRootSagaCrashed()).toBe(false);
  });
});

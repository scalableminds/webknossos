import test from "ava";
import { waitForCondition } from "libs/utils";
import mockRequire from "mock-require";
import "test/mocks/lz4";
import "test/sagas/saga_integration.mock";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import Store from "oxalis/store";
import dummyUser from "test/fixtures/dummy_user";
import { __setupOxalis, createBucketResponseFunction } from "test/helpers/apiHelpers";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";

const { discardSaveQueuesAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");

test.beforeEach(async (t) => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  Store.dispatch(setActiveUserAction(dummyUser));

  await __setupOxalis(t, "volume");
  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.serial(
  "Brushing/Tracing should not crash when a lot of buckets are labeled at once without saving in between",
  async (t) => {
    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
    await t.context.api.tracing.save();
    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
    t.context.mocks.Request.sendJSONReceiveArraybufferWithHeaders = createBucketResponseFunction(
      Uint16Array,
      0,
      0,
    );
    // In earlier versions of webKnossos, buckets could be evicted forcefully when
    // too many were dirty at the same time. This led to a crash in earlier versions.
    // Now, the code should not crash, anymore.
    t.plan(2);
    t.false(hasRootSagaCrashed());
    const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
    await Promise.race([testLabelingManyBuckets(t, false), failedSagaPromise]);
    t.false(hasRootSagaCrashed());
  },
);

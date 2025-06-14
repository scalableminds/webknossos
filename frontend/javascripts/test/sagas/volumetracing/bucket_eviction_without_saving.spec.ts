import { vi, it, expect, beforeEach } from "vitest";
import { waitForCondition } from "libs/utils";
import {
  setupWebknossosForTesting,
  createBucketResponseFunction,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";

beforeEach<WebknossosTestContext>(async (context) => {
  await setupWebknossosForTesting(context, "volume");
});

it<WebknossosTestContext>("Brushing/Tracing should not crash when a lot of buckets are labeled at once without saving in between", async (context) => {
  const { api, mocks } = context;
  await api.tracing.save();
  vi.mocked(mocks.Request.sendJSONReceiveArraybufferWithHeaders).mockImplementation(
    createBucketResponseFunction(Uint16Array, 0, 0),
  );
  // In earlier versions of webKnossos, buckets could be evicted forcefully when
  // too many were dirty at the same time. This led to a crash in earlier versions.
  // Now, the code should not crash, anymore.
  expect(hasRootSagaCrashed()).toBe(false);
  const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
  await Promise.race([testLabelingManyBuckets(context, false), failedSagaPromise]);
  expect(hasRootSagaCrashed()).toBe(false);
});

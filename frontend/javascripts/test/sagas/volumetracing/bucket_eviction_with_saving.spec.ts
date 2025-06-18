import { vi, it, expect, beforeEach, describe } from "vitest";
import { waitForCondition } from "libs/utils";
import {
  setupWebknossosForTesting,
  createBucketResponseFunction,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";

describe("Bucket Eviction With Saving", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "volume");
  });

  it<WebknossosTestContext>("Brushing/Tracing should not crash when too many buckets are labeled at once with saving in between", async (context) => {
    const { api, mocks } = context;
    await api.tracing.save();

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.withImplementation(
      createBucketResponseFunction(Uint16Array, 0, 0),
      async () => {
        expect(hasRootSagaCrashed()).toBe(false);

        const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
        await Promise.race([testLabelingManyBuckets(context, true), failedSagaPromise]);

        expect(hasRootSagaCrashed()).toBe(false);
      },
    );
  });
});

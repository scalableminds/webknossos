import { waitForCondition } from "libs/utils";
import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testLabelingManyBuckets } from "./bucket_eviction_helper";

describe("Bucket Eviction With Saving", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "volume");
  });

  it<WebknossosTestContext>("Brushing/Tracing should not crash when too many buckets are labeled at once with saving in between", async (context) => {
    const { api, mocks } = context;
    await api.tracing.save();

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.withImplementation(
      createBucketResponseFunction({ color: "uint8", segmentation: "uint16" }, 0, 0),
      async () => {
        expect(hasRootSagaCrashed()).toBe(false);

        const failedSagaPromise = waitForCondition(hasRootSagaCrashed, 500);
        await Promise.race([testLabelingManyBuckets(context, true), failedSagaPromise]);

        expect(hasRootSagaCrashed()).toBe(false);
      },
    );
  });
});

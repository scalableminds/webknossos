import {
  createBucketResponseFunction,
  setupWebknossosForTesting,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { call } from "typed-redux-saga";
import type { Vector3 } from "viewer/constants";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { tryToIncorporateActions } from "viewer/model/sagas/saving/save_saga";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Volume Tracing with remote updates", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "volume");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    // Saving after each test and checking that the root saga didn't crash,
    // ensures that each test is cleanly exited. Without it weird output can
    // occur (e.g., a promise gets resolved which interferes with the next test).
    await context.api.tracing.save();
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("A bucket should automatically be reloaded if newer data exists on the server", async ({
    api,
    mocks,
  }) => {
    const oldCellId = 11;

    vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
      createBucketResponseFunction(Uint16Array, oldCellId, 5),
    );

    // Reload buckets which might have already been loaded before swapping the sendJSONReceiveArraybufferWithHeaders
    // function.
    await api.data.reloadAllBuckets();

    const task = startSaga(function* () {
      const position = [0, 0, 0] as Vector3;
      const newCellId = 2;
      const volumeTracingLayerName = api.data.getVolumeTracingLayerIds()[0];

      expect(
        yield call(() => api.data.getDataValue(volumeTracingLayerName, position)),
        "Initially, there should be oldCellId",
      ).toBe(oldCellId);

      // Already prepare the updated backend response.
      vi.mocked(mocks.Request).sendJSONReceiveArraybufferWithHeaders.mockImplementation(
        createBucketResponseFunction(Uint16Array, newCellId, 5),
      );

      yield tryToIncorporateActions([
        {
          version: 1,
          value: [
            {
              name: "updateBucket",
              value: {
                actionTracingId: "volumeTracingId",
                actionTimestamp: 0,
                position,
                additionalCoordinates: undefined,
                mag: [1, 1, 1],
                cubeSize: 1024,
                base64Data: undefined, // The server will not send this, either.
              },
            },
          ],
        },
      ]);

      expect(yield call(() => api.data.getDataValue(volumeTracingLayerName, position))).toBe(
        newCellId,
      );
    });

    await task.toPromise();
  });
});

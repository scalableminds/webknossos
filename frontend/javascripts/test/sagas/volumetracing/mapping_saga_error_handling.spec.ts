import type { ApiResult } from "admin/api/api_result";
import { sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import { setMappingAction } from "viewer/model/actions/settings_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failedResult: ApiResult<string[]> = {
  ok: false,
  error: { kind: "network", message: "Failed to fetch", cause: new Error("Failed to fetch") },
};

describe("Mapping saga error handling", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "volume");
    context.mocks.getMappingsForDatasetLayer.mockResolvedValue(failedResult);
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it<WebknossosTestContext>("should not crash when the available mappings cannot be loaded", async ({
    mocks,
  }) => {
    const layerName = getVisibleSegmentationLayer(Store.getState())!.name;
    Store.dispatch(ensureLayerMappingsAreLoadedAction(layerName));

    await vi.waitFor(() => expect(mocks.getMappingsForDatasetLayer).toHaveBeenCalled());
    // Give the saga the chance to process the failed result.
    await sleep(10);
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should reset the mapping when the available mappings cannot be loaded during activation", async () => {
    const layerName = getVisibleSegmentationLayer(Store.getState())!.name;
    Store.dispatch(setMappingAction(layerName, "some-mapping", "JSON", false));

    await vi.waitFor(() =>
      expect(
        Store.getState().temporaryConfiguration.activeMappingByLayer[layerName].mappingName,
      ).toBeNull(),
    );
  });
});

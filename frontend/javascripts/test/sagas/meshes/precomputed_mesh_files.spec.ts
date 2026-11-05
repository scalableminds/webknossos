// biome-ignore assist/source/organizeImports: apiHelpers need to be imported first for proper mocking of modules
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { ApiResult } from "admin/api/api_result";
import { getMeshFilesForDatasetLayer } from "admin/rest_api";
import { sleep } from "libs/utils";
import type { APIMeshFileInfo } from "types/api_types";
import { getSegmentationLayers } from "viewer/model/accessors/dataset_accessor";
import { dispatchMaybeFetchMeshFilesAsync } from "viewer/model/actions/annotation_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failedResult: ApiResult<APIMeshFileInfo[]> = {
  ok: false,
  error: {
    kind: "network",
    message: "Failed to fetch",
    cause: new TypeError("Failed to fetch"),
  },
};

describe("Fetching mesh files", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    // Use a hybrid annotation so that the segmentation layer has a fallback layer (only these can have mesh files).
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function getSegmentationLayerAndDataset() {
    const { dataset } = Store.getState();
    return { dataset, layer: getSegmentationLayers(dataset)[0] };
  }

  it("should return no mesh files (and keep the sagas alive) if the request fails", async () => {
    const { dataset, layer } = getSegmentationLayerAndDataset();
    vi.mocked(getMeshFilesForDatasetLayer).mockResolvedValueOnce(failedResult);

    const meshFiles = await dispatchMaybeFetchMeshFilesAsync(Store.dispatch, layer, dataset, false);

    expect(meshFiles).toEqual([]);
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should resolve concurrent requests if the request fails", async () => {
    const { dataset, layer } = getSegmentationLayerAndDataset();
    vi.mocked(getMeshFilesForDatasetLayer).mockImplementationOnce(async () => {
      await sleep(50);
      return failedResult;
    });

    const [first, second] = await Promise.all([
      dispatchMaybeFetchMeshFilesAsync(Store.dispatch, layer, dataset, false),
      dispatchMaybeFetchMeshFilesAsync(Store.dispatch, layer, dataset, false),
    ]);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it("should not cache a failed request", async () => {
    const { dataset, layer } = getSegmentationLayerAndDataset();
    const mockedFetch = vi.mocked(getMeshFilesForDatasetLayer);
    mockedFetch.mockClear();
    mockedFetch.mockResolvedValueOnce(failedResult);

    await dispatchMaybeFetchMeshFilesAsync(Store.dispatch, layer, dataset, false);
    const meshFiles = await dispatchMaybeFetchMeshFilesAsync(Store.dispatch, layer, dataset, false);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(meshFiles.length).toBeGreaterThan(0);
  });
});

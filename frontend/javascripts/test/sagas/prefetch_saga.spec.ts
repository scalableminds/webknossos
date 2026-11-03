import { call } from "redux-saga/effects";
import constants from "viewer/constants";
import Model from "viewer/model";
import { prefetchForPlaneMode, triggerDataPrefetching } from "viewer/model/sagas/prefetch_saga";
import { setModel } from "viewer/singletons";
import { describe, expect, it, vi } from "vitest";
import DATASET from "../fixtures/dataset_server_object";
import { execCall, expectValueDeepEqual } from "../helpers/saga_test_helpers";

setModel(Model);

vi.mock("viewer/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

describe("Prefetch Saga", () => {
  it("should not prefetch in flight mode", () => {
    const saga = triggerDataPrefetching({});
    saga.next(); // select viewMode

    expect(saga.next(constants.MODE_FLIGHT).done).toBe(true);
  });

  it("should not prefetch segmentation if it is not visible", () => {
    // These are not the correct layers (those should be data_layer instances)
    // but they are sufficient to test this saga
    const allLayers = DATASET.dataSource.dataLayers;
    const previousProperties = {};
    const viewMode = constants.MODE_PLANE_TRACING;
    const saga = triggerDataPrefetching(previousProperties);
    saga.next(); // select viewMode

    expectValueDeepEqual(expect, saga.next(viewMode), call([Model, Model.getAllLayers] as any));
    let shouldPrefetchSaga = execCall(expect, saga.next(allLayers)); // shouldPrefetchForDataLayer

    shouldPrefetchSaga.next(); // isLayerVisible

    const shouldPrefetchDataLayer = shouldPrefetchSaga.next(true).value;
    // The color layer should be prefetched, because it is visible
    expect(shouldPrefetchDataLayer).toBe(true);
    expectValueDeepEqual(
      expect,
      saga.next(shouldPrefetchDataLayer),
      call(prefetchForPlaneMode as any, allLayers[0], previousProperties),
    );
    shouldPrefetchSaga = execCall(expect, saga.next()); // shouldPrefetchForDataLayer

    shouldPrefetchSaga.next(); // isLayerVisible

    const shouldPrefetchSegmentationLayer = shouldPrefetchSaga.next(false).value;
    // The segmentation layer should not be prefetched because it is not visible
    expect(shouldPrefetchSegmentationLayer).toBe(false);
    // The saga should be over afterwards - no prefetch call
    expect(saga.next(shouldPrefetchSegmentationLayer).done).toBe(true);
  });
});

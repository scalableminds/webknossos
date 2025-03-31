import { describe, it, expect, vi } from "vitest";
import Model from "oxalis/model";
import constants from "oxalis/constants";
import DATASET from "../fixtures/dataset_server_object";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import { setModel } from "oxalis/singletons";
import { call } from "redux-saga/effects";
import {
  triggerDataPrefetching,
  prefetchForArbitraryMode,
  prefetchForPlaneMode,
} from "oxalis/model/sagas/prefetch_saga";

setModel(Model);

vi.mock("oxalis/model/sagas/root_saga", () => {
  return {
    default: function* () {
      yield;
    },
  };
});

describe("Prefetch Saga", () => {
  it("should trigger prefetching for the correct view mode", () => {
    // These are not the correct layers (those should be data_layer instances)
    // but they are sufficient to test this saga
    const allLayers = DATASET.dataSource.dataLayers;
    const previousProperties = {};
    const saga = triggerDataPrefetching(previousProperties);
    saga.next(); // select viewMode

    saga.next(constants.MODE_ARBITRARY); // Model.getAllLayers

    saga.next(allLayers); // shouldPrefetchForDataLayer

    expectValueDeepEqual(
      expect,
      saga.next(true),
      call(prefetchForArbitraryMode as any, allLayers[0], previousProperties),
    );
    // Saga should not be over as there are multiple layers
    expect(saga.next().done).toBe(false);
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
    // Manually apply both values to saga to make progress, but only pass first one to execCall
    saga.next(allLayers);
    let shouldPrefetchSaga = execCall(expect, saga.next()); // shouldPrefetchForDataLayer

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

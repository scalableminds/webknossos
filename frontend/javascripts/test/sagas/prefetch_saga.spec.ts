import "test/mocks/lz4";
import Model from "oxalis/model";
import constants from "oxalis/constants";
import mockRequire from "mock-require";
import test from "ava";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import DATASET from "../fixtures/dataset_server_object";

const { setModel } = require("oxalis/singletons");

setModel(Model);

mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});

const { call } = mockRequire.reRequire("redux-saga/effects");
const { triggerDataPrefetching, prefetchForArbitraryMode, prefetchForPlaneMode } =
  mockRequire.reRequire("oxalis/model/sagas/prefetch_saga");
test("Prefetch saga should trigger prefetching for the correct view mode", (t) => {
  // These are not the correct layers (those should be data_layer instances)
  // but they are sufficient to test this saga
  const allLayers = DATASET.dataSource.dataLayers;
  const previousProperties = {};
  const saga = triggerDataPrefetching(previousProperties);
  saga.next(); // select viewMode

  saga.next(constants.MODE_ARBITRARY); // Model.getAllLayers

  saga.next(allLayers); // shouldPrefetchForDataLayer

  expectValueDeepEqual(
    t,
    saga.next(true),
    call(prefetchForArbitraryMode, allLayers[0], previousProperties),
  );
  // Saga should not be over as there are multiple layers
  t.is(saga.next().done, false);
});
test("Prefetch saga should not prefetch segmentation if it is not visible", (t) => {
  // These are not the correct layers (those should be data_layer instances)
  // but they are sufficient to test this saga
  const allLayers = DATASET.dataSource.dataLayers;
  const previousProperties = {};
  const viewMode = constants.MODE_PLANE_TRACING;
  const saga = triggerDataPrefetching(previousProperties);
  saga.next(); // select viewMode

  expectValueDeepEqual(t, saga.next(viewMode), call([Model, Model.getAllLayers]));
  let shouldPrefetchSaga = execCall(t, saga.next(allLayers, viewMode)); // shouldPrefetchForDataLayer

  shouldPrefetchSaga.next(); // isLayerVisible

  const shouldPrefetchDataLayer = shouldPrefetchSaga.next(true).value;
  // The color layer should be prefetched, because it is visible
  t.is(shouldPrefetchDataLayer, true);
  expectValueDeepEqual(
    t,
    saga.next(shouldPrefetchDataLayer),
    call(prefetchForPlaneMode, allLayers[0], previousProperties),
  );
  shouldPrefetchSaga = execCall(t, saga.next()); // shouldPrefetchForDataLayer

  shouldPrefetchSaga.next(); // isLayerVisible

  const shouldPrefetchSegmentationLayer = shouldPrefetchSaga.next(false).value;
  // The segmentation layer should not be prefetched because it is not visible
  t.is(shouldPrefetchSegmentationLayer, false);
  // The saga should be over afterwards - no prefetch call
  t.is(saga.next(shouldPrefetchSegmentationLayer).done, true);
});

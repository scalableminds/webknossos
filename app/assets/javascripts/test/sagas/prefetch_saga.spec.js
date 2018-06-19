// @flow

import test from "ava";
import mockRequire from "mock-require";
import constants from "oxalis/constants";
import Model from "oxalis/model";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import DATASET from "../fixtures/dataset_server_object";

mockRequire.stopAll();

mockRequire("oxalis/model/sagas/root_saga", function*() {
  yield;
});
const { call } = mockRequire.reRequire("redux-saga/effects");

const {
  triggerDataPrefetching,
  prefetchForArbitraryMode,
  prefetchForPlaneMode,
} = mockRequire.reRequire("oxalis/model/sagas/prefetch_saga");

test("Prefetch saga should trigger prefetching for the correct view mode", t => {
  // These are not the correct layers (those should be data_layer instances)
  // but they are sufficient to test this saga
  const colorLayers = DATASET.dataSource.dataLayers.filter(layer => layer.category === "color");
  const previousProperties = {};
  const saga = triggerDataPrefetching(previousProperties);
  saga.next(); // select viewMode
  saga.next(constants.MODE_ARBITRARY);
  expectValueDeepEqual(
    t,
    saga.next(colorLayers),
    call(prefetchForArbitraryMode, colorLayers[0], previousProperties),
  );
  t.is(saga.next().done, true);
});

test("Prefetch saga should not prefetch segmentation if it is not visible", t => {
  // These are not the correct layers (those should be data_layer instances)
  // but they are sufficient to test this saga
  const allLayers = DATASET.dataSource.dataLayers;
  const colorLayers = DATASET.dataSource.dataLayers.filter(layer => layer.category === "color");
  const previousProperties = {};
  const saga = triggerDataPrefetching(previousProperties);
  saga.next(); // select viewMode
  expectValueDeepEqual(
    t,
    saga.next(constants.MODE_PLANE_TRACING),
    call([Model, Model.getAllLayers]),
  );

  let shouldPrefetchSaga = execCall(t, saga.next(allLayers)); // shouldPrefetchForDataLayer
  shouldPrefetchSaga.next();
  shouldPrefetchSaga.next(0); // select segmentationOpacity
  const shouldPrefetchColorLayer = shouldPrefetchSaga.next(false).value;
  // The color layer should be prefetched, although the segmentationOpacity is 0
  t.is(shouldPrefetchColorLayer, true);
  expectValueDeepEqual(
    t,
    saga.next(shouldPrefetchColorLayer),
    call(prefetchForPlaneMode, colorLayers[0], previousProperties),
  );

  shouldPrefetchSaga = execCall(t, saga.next()); // shouldPrefetchForDataLayer
  shouldPrefetchSaga.next();
  shouldPrefetchSaga.next(0); // select segmentationOpacity
  const shouldPrefetchSegmentationLayer = shouldPrefetchSaga.next(true).value;
  // The segmentation layer should not be prefetched because it is not visible
  t.is(shouldPrefetchSegmentationLayer, false);
  // So the saga should be over afterwards, no prefetch call
  t.is(saga.next(shouldPrefetchSegmentationLayer).done, true);
});

// @flow
import Model from "oxalis/model";
import constants from "oxalis/constants";
import { throttle, select, take, call } from "redux-saga/effects";
import {
  getPosition,
  getRequestLogZoomStep,
  getAreas,
} from "oxalis/model/accessors/flycam_accessor";
import {
  PrefetchStrategySkeleton,
  PrefetchStrategyVolume,
} from "oxalis/model/bucket_data_handling/prefetch_strategy_plane";
import { PrefetchStrategyArbitrary } from "oxalis/model/bucket_data_handling/prefetch_strategy_arbitrary";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import DataLayer from "oxalis/model/data_layer";
import type { Vector3 } from "oxalis/constants";
import {
  isSegmentationLayer,
  getResolutions,
  getColorLayers,
} from "oxalis/model/accessors/dataset_accessor";
import type { DataLayerType } from "oxalis/store";

const PREFETCH_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;

const prefetchStrategiesArbitrary = [new PrefetchStrategyArbitrary()];
const prefetchStrategiesPlane = [new PrefetchStrategySkeleton(), new PrefetchStrategyVolume()];

export function* watchDataRelevantChanges(): Generator<*, *, *> {
  yield take("WK_READY");

  const previousProperties = {};
  yield throttle(PREFETCH_THROTTLE_TIME, FlycamActions, triggerDataPrefetching, previousProperties);
}

function* shouldPrefetchForDataLayer(dataLayer: DataLayer): Generator<*, *, *> {
  const segmentationOpacity = yield select(state => state.datasetConfiguration.segmentationOpacity);
  const isSegmentationVisible = segmentationOpacity !== 0;
  const isSegmentation = yield select(state => isSegmentationLayer(state.dataset, dataLayer.name));
  // There is no need to prefetch data for segmentation layers that are not visible
  return !isSegmentation || isSegmentationVisible;
}

export function* triggerDataPrefetching(previousProperties: Object): Generator<*, *, *> {
  const currentViewMode = yield select(state => state.temporaryConfiguration.viewMode);
  const isPlaneMode = constants.MODES_PLANE.includes(currentViewMode);

  if (isPlaneMode) {
    const dataLayers = yield call([Model, Model.getAllLayers]);
    for (const dataLayer of dataLayers) {
      if (yield call(shouldPrefetchForDataLayer, dataLayer)) {
        yield call(prefetchForPlaneMode, dataLayer, previousProperties);
      }
    }
  } else {
    const dataLayers = yield select(state => getColorLayers(state.dataset));
    for (const colorLayer of dataLayers) {
      yield call(prefetchForArbitraryMode, colorLayer, previousProperties);
    }
  }
}

function getTraceDirection(
  position: Vector3,
  lastPosition: ?Vector3,
  lastDirection: ?Vector3,
): Vector3 {
  let direction = lastDirection || [0, 0, 0];
  if (lastPosition != null) {
    direction = [
      (1 - DIRECTION_VECTOR_SMOOTHER) * direction[0] +
        DIRECTION_VECTOR_SMOOTHER * (position[0] - lastPosition[0]),
      (1 - DIRECTION_VECTOR_SMOOTHER) * direction[1] +
        DIRECTION_VECTOR_SMOOTHER * (position[1] - lastPosition[1]),
      (1 - DIRECTION_VECTOR_SMOOTHER) * direction[2] +
        DIRECTION_VECTOR_SMOOTHER * (position[2] - lastPosition[2]),
    ];
  }
  return direction;
}

export function* prefetchForPlaneMode(
  layer: DataLayer,
  previousProperties: Object,
): Generator<*, *, *> {
  const position = yield select(state => getPosition(state.flycam));
  const zoomStep = yield select(state => getRequestLogZoomStep(state));
  const activePlane = yield select(state => state.viewModeData.plane.activeViewport);
  const tracingType = yield select(state => state.tracing.type);
  const { lastPosition, lastDirection, lastZoomStep } = previousProperties;
  const direction = getTraceDirection(position, lastPosition, lastDirection);
  const resolutions = yield select(state => getResolutions(state.dataset));

  if (position !== lastPosition || zoomStep !== lastZoomStep) {
    const areas = yield select(state => getAreas(state));
    for (const strategy of prefetchStrategiesPlane) {
      if (
        strategy.forContentType(tracingType) &&
        strategy.inVelocityRange(layer.connectionInfo.bandwidth) &&
        strategy.inRoundTripTimeRange(layer.connectionInfo.roundTripTime)
      ) {
        layer.pullQueue.clearNormalPriorities();
        const buckets = strategy.prefetch(
          layer.cube,
          position,
          direction,
          zoomStep,
          activePlane,
          areas,
          resolutions,
        );
        layer.pullQueue.addAll(buckets);
        break;
      }
    }

    layer.pullQueue.pull();
    previousProperties.lastPosition = position;
    previousProperties.lastZoomStep = zoomStep;
    previousProperties.lastDirection = direction;
  }
}

export function* prefetchForArbitraryMode(
  layer: DataLayerType,
  previousProperties: Object,
): Generator<*, *, *> {
  const matrix = yield select(state => state.flycam.currentMatrix);
  const zoomStep = yield select(state => getRequestLogZoomStep(state));
  const tracingType = yield select(state => state.tracing.type);
  const { lastMatrix, lastZoomStep } = previousProperties;
  const { connectionInfo, pullQueue } = Model.dataLayers[layer.name];

  if (matrix !== lastMatrix || zoomStep !== lastZoomStep) {
    for (const strategy of prefetchStrategiesArbitrary) {
      if (
        strategy.forContentType(tracingType) &&
        strategy.inVelocityRange(connectionInfo.bandwidth) &&
        strategy.inRoundTripTimeRange(connectionInfo.roundTripTime)
      ) {
        pullQueue.clearNormalPriorities();
        const buckets = strategy.prefetch(matrix, zoomStep);
        pullQueue.addAll(buckets);
        break;
      }
    }
  }

  pullQueue.pull();
  previousProperties.lastMatrix = matrix;
  previousProperties.lastZoomStep = zoomStep;
}

export default {};

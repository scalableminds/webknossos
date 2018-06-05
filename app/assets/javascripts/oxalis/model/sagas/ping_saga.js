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
  SkeletonPingStrategy,
  VolumePingStrategy,
} from "oxalis/model/bucket_data_handling/ping_strategy";
import { DslSlowPingStrategy3d } from "oxalis/model/bucket_data_handling/ping_strategy_3d";
import { FlycamActions } from "oxalis/model/actions/flycam_actions";
import DataLayer from "oxalis/model/data_layer";

const PING_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;

const pingStrategies3d = [new DslSlowPingStrategy3d()];
const pingStrategies = [new SkeletonPingStrategy(), new VolumePingStrategy()];

export function* watchDataRelevantChanges(): Generator<*, *, *> {
  yield take("WK_READY");

  const previousProperties = { lastDirection: [0, 0, 0] };
  yield throttle(PING_THROTTLE_TIME, FlycamActions, triggerDataFetching, previousProperties);
}

function* shouldPingDataLayer(dataLayer: DataLayer): Generator<*, *, *> {
  const isSegmentationLayer = dataLayer.category === "segmentation";
  const isSegmentationVisible = yield select(
    state => state.datasetConfiguration.segmentationOpacity !== 0,
  );
  // There is no need to prefetch data for segmentation layers that are not visible
  return !isSegmentationLayer || isSegmentationVisible;
}

function* triggerDataFetching(previousProperties: Object): Generator<*, *, *> {
  console.log("triggerDataFetching");
  const currentViewMode = yield select(state => state.temporaryConfiguration.viewMode);
  const isPlaneMode = constants.MODES_PLANE.includes(currentViewMode);

  if (isPlaneMode) {
    for (const dataLayer of Object.values(Model.dataLayers)) {
      if (yield call(shouldPingDataLayer, dataLayer)) {
        yield call(pingPlaneMode, dataLayer, previousProperties);
      }
    }
  } else {
    for (const colorLayer of Model.getColorLayers()) {
      yield call(pingArbitraryMode, colorLayer, previousProperties);
    }
  }
}

function* pingPlaneMode(layer: DataLayer, previousProperties: Object): Generator<*, *, *> {
  const position = yield select(state => getPosition(state.flycam));
  const zoomStep = yield select(state => getRequestLogZoomStep(state));
  const activePlane = yield select(state => state.viewModeData.plane.activeViewport);
  const tracingType = yield select(state => state.tracing.type);
  const { lastPosition, lastDirection, lastZoomStep } = previousProperties;

  let direction = lastDirection;
  if (lastPosition != null) {
    direction = [
      (1 - DIRECTION_VECTOR_SMOOTHER) * lastDirection[0] +
        DIRECTION_VECTOR_SMOOTHER * (position[0] - lastPosition[0]),
      (1 - DIRECTION_VECTOR_SMOOTHER) * lastDirection[1] +
        DIRECTION_VECTOR_SMOOTHER * (position[1] - lastPosition[1]),
      (1 - DIRECTION_VECTOR_SMOOTHER) * lastDirection[2] +
        DIRECTION_VECTOR_SMOOTHER * (position[2] - lastPosition[2]),
    ];
  }
  if (position !== lastPosition || zoomStep !== lastZoomStep) {
    const areas = yield select(state => getAreas(state));
    for (const strategy of pingStrategies) {
      if (
        strategy.forContentType(tracingType) &&
        strategy.inVelocityRange(layer.connectionInfo.bandwidth) &&
        strategy.inRoundTripTimeRange(layer.connectionInfo.roundTripTime)
      ) {
        layer.pullQueue.clearNormalPriorities();
        const buckets = strategy.ping(
          layer.cube,
          position,
          direction,
          zoomStep,
          activePlane,
          areas,
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

function* pingArbitraryMode(layer: DataLayer, previousProperties: Object): Generator<*, *, *> {
  const matrix = yield select(state => state.flycam.currentMatrix);
  const zoomStep = yield select(state => getRequestLogZoomStep(state));
  const tracingType = yield select(state => state.tracing.type);
  const { lastMatrix, lastZoomStep } = previousProperties;

  if (matrix !== lastMatrix || zoomStep !== lastZoomStep) {
    for (const strategy of pingStrategies3d) {
      if (
        strategy.forContentType(tracingType) &&
        strategy.inVelocityRange(layer.connectionInfo.bandwidth) &&
        strategy.inRoundTripTimeRange(layer.connectionInfo.roundTripTime)
      ) {
        layer.pullQueue.clearNormalPriorities();
        const buckets = strategy.ping(matrix, zoomStep);
        layer.pullQueue.addAll(buckets);
        break;
      }
    }
  }

  layer.pullQueue.pull();
  previousProperties.lastMatrix = matrix;
  previousProperties.lastZoomStep = zoomStep;
}

export default {};

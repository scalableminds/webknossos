import { call, throttle } from "typed-redux-saga";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3 } from "viewer/constants";
import constants from "viewer/constants";
import { getMagInfo, isLayerVisible } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveMagIndexForLayer,
  getAreasFromState,
  getPosition,
  isRotated,
} from "viewer/model/accessors/flycam_accessor";
import { FlycamActions } from "viewer/model/actions/flycam_actions";
import { PrefetchStrategyArbitrary } from "viewer/model/bucket_data_handling/prefetch_strategy_arbitrary";
import {
  ContentTypes as PrefetchContentTypes,
  PrefetchStrategySkeleton,
  PrefetchStrategyVolume,
} from "viewer/model/bucket_data_handling/prefetch_strategy_plane";
import { getGlobalDataConnectionInfo } from "viewer/model/data_connection_info";
import type DataLayer from "viewer/model/data_layer";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { Model } from "viewer/singletons";
import type { WebknossosState } from "viewer/store";
import { ensureWkReady } from "./ready_sagas";

const PREFETCH_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;
const prefetchStrategiesArbitrary = [new PrefetchStrategyArbitrary()];
const prefetchStrategiesPlane = [new PrefetchStrategySkeleton(), new PrefetchStrategyVolume()];

export function* watchDataRelevantChanges(): Saga<void> {
  yield* call(ensureWkReady);

  const previousProperties = {};
  // Initiate the prefetching once and then only for data relevant changes
  yield* call(triggerDataPrefetching, previousProperties);
  yield* throttle(
    PREFETCH_THROTTLE_TIME,
    FlycamActions,
    triggerDataPrefetching,
    previousProperties,
  );
}

function* shouldPrefetchForDataLayer(dataLayer: DataLayer): Saga<boolean> {
  // There is no need to prefetch data for layers that are not visible
  return yield* select((state) => {
    const isNotRotated = !isRotated(state.flycam);
    return (
      isNotRotated &&
      isLayerVisible(
        state.dataset,
        dataLayer.name,
        state.datasetConfiguration,
        state.temporaryConfiguration.viewMode,
      )
    );
  });
}

export function* triggerDataPrefetching(previousProperties: Record<string, any>): Saga<void> {
  const viewMode = yield* select((state) => state.temporaryConfiguration.viewMode);
  const isPlaneMode = constants.MODES_PLANE.includes(viewMode);
  const dataLayers = yield* call([Model, Model.getAllLayers]);

  for (const dataLayer of dataLayers) {
    if (yield* call(shouldPrefetchForDataLayer, dataLayer)) {
      if (isPlaneMode) {
        yield* call(prefetchForPlaneMode, dataLayer, previousProperties);
      } else {
        yield* call(prefetchForArbitraryMode, dataLayer, previousProperties);
      }
    }
  }
}

function getTraceDirection(
  position: Vector3,
  lastPosition: Vector3 | null | undefined,
  lastDirection: Vector3 | null | undefined,
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

function getTracingTypes(state: WebknossosState) {
  return {
    [PrefetchContentTypes.SKELETON]: state.annotation.skeleton != null,
    [PrefetchContentTypes.VOLUME]: state.annotation.volumes.length > 0,
    [PrefetchContentTypes.READ_ONLY]: state.annotation.readOnly != null,
  };
}

export function* prefetchForPlaneMode(
  layer: DataLayer,
  previousProperties: Record<string, any>,
): Saga<void> {
  const position = yield* select((state) => getPosition(state.flycam));
  const zoomStep = yield* select((state) => getActiveMagIndexForLayer(state, layer.name));
  const magInfo = getMagInfo(layer.mags);
  const activePlane = yield* select((state) => state.viewModeData.plane.activeViewport);
  const tracingTypes = yield* select(getTracingTypes);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const lastConnectionStats = getGlobalDataConnectionInfo().lastStats;
  const { lastPosition, lastDirection, lastZoomStep, lastBucketPickerTick } = previousProperties;
  const direction = getTraceDirection(position, lastPosition, lastDirection);
  const mags = magInfo.getDenseMags();
  const layerRenderingManager = yield* call(
    [Model, Model.getLayerRenderingManagerByName],
    layer.name,
  );
  const { currentBucketPickerTick } = layerRenderingManager;

  if (
    currentBucketPickerTick !== lastBucketPickerTick &&
    (position !== lastPosition || zoomStep !== lastZoomStep)
  ) {
    const areas = yield* select((state) => getAreasFromState(state));

    for (const strategy of prefetchStrategiesPlane) {
      if (
        strategy.forContentType(tracingTypes) &&
        strategy.inVelocityRange(lastConnectionStats.avgDownloadSpeedInBytesPerS) &&
        strategy.inRoundTripTimeRange(lastConnectionStats.avgRoundTripTime)
      ) {
        const buckets = strategy.prefetch(
          layer.cube,
          position,
          direction,
          zoomStep,
          activePlane,
          areas,
          mags,
          magInfo,
          additionalCoordinates,
        );

        if (WkDevFlags.bucketDebugging.visualizePrefetchedBuckets) {
          for (const item of buckets) {
            const bucket = layer.cube.getOrCreateBucket(item.bucket);

            if (bucket.type !== "null") {
              bucket.visualize();
            }
          }
        }

        layer.pullQueue.addAll(buckets);
        break;
      }
    }

    layer.pullQueue.pull();
    previousProperties.lastPosition = position;
    previousProperties.lastZoomStep = zoomStep;
    previousProperties.lastDirection = direction;
    previousProperties.lastBucketPickerTick = currentBucketPickerTick;
  }
}
export function* prefetchForArbitraryMode(
  layer: DataLayer,
  previousProperties: Record<string, any>,
): Saga<void> {
  const position = yield* select((state) => getPosition(state.flycam));
  const matrix = yield* select((state) => state.flycam.currentMatrix);
  const zoomStep = yield* select((state) => getActiveMagIndexForLayer(state, layer.name));
  const tracingTypes = yield* select(getTracingTypes);
  const magInfo = getMagInfo(layer.mags);
  const mags = magInfo.getDenseMags();
  const layerRenderingManager = yield* call(
    [Model, Model.getLayerRenderingManagerByName],
    layer.name,
  );
  const { currentBucketPickerTick } = layerRenderingManager;
  const { lastMatrix, lastZoomStep, lastBucketPickerTick } = previousProperties;
  const { pullQueue, cube } = Model.dataLayers[layer.name];
  const lastConnectionStats = getGlobalDataConnectionInfo().lastStats;
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);

  if (
    currentBucketPickerTick !== lastBucketPickerTick &&
    (matrix !== lastMatrix || zoomStep !== lastZoomStep)
  ) {
    for (const strategy of prefetchStrategiesArbitrary) {
      if (
        strategy.forContentType(tracingTypes) &&
        strategy.inVelocityRange(lastConnectionStats.avgDownloadSpeedInBytesPerS) &&
        strategy.inRoundTripTimeRange(lastConnectionStats.avgRoundTripTime)
      ) {
        const buckets = strategy.prefetch(
          matrix,
          zoomStep,
          position,
          mags,
          magInfo,
          additionalCoordinates,
        );

        if (WkDevFlags.bucketDebugging.visualizePrefetchedBuckets) {
          for (const item of buckets) {
            const bucket = cube.getOrCreateBucket(item.bucket);

            if (bucket.type !== "null") {
              bucket.visualize();
            }
          }
        }
        pullQueue.addAll(buckets);
        break;
      }
    }
  }

  pullQueue.pull();
  previousProperties.lastMatrix = matrix;
  previousProperties.lastZoomStep = zoomStep;
  previousProperties.lastBucketPickerTick = currentBucketPickerTick;
}
export default {};

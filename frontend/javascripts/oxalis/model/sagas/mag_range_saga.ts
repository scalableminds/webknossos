import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, take } from "oxalis/model/sagas/effect-generators";
import { Store } from "oxalis/singletons";
import type { OxalisState } from "oxalis/store";
import AsyncGetMaximumZoomForAllMags from "oxalis/workers/async_get_maximum_zoom_for_all_mags.worker";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { EventChannel, eventChannel } from "redux-saga";
import { put } from "typed-redux-saga";
import type { OrthoViewRects, Vector3, ViewMode } from "oxalis/constants";
import type { LoadingStrategy } from "oxalis/store";
import type { Matrix4x4 } from "mjs";
import { getDataLayers, getMagInfo } from "../accessors/dataset_accessor";
import {
  getTransformsForLayer,
  invertAndTranspose,
} from "../accessors/dataset_layer_transformation_accessor";
import { _getDummyFlycamMatrix } from "../accessors/flycam_accessor";
import { setMagRangeForLayerAction } from "../actions/flycam_info_cache_actions";
import { ensureWkReady } from "./ready_sagas";
import memoizeOne from "memoize-one";
import { getViewportRects } from "../accessors/view_mode_accessor";
import constants from "oxalis/constants";
import _ from "lodash";

const asyncGetMaximumZoomForAllMagsRaw = createWorker(AsyncGetMaximumZoomForAllMags);
const asyncGetMaximumZoomForAllMags: typeof asyncGetMaximumZoomForAllMagsRaw = memoizeOne(
  asyncGetMaximumZoomForAllMagsRaw,
  (oldArgs, newArgs) => _.isEqual(oldArgs, newArgs),
);

function createStoreChannel(): EventChannel<OxalisState> {
  return eventChannel((emit) => {
    const unsubscribe = Store.subscribe(() => {
      emit(Store.getState()); // Emit the new state whenever it changes
    });
    return unsubscribe;
  });
}

const getComputeFunction = _.memoize((_layerName: string) => {
  // The argument _layerName is not used in this function, but
  // we want to have one memoized function per layer name which
  // is why the argument is still needed.
  return memoizeOne(
    (
      viewMode: ViewMode,
      loadingStrategy: LoadingStrategy,
      voxelSizeFactor: Vector3,
      mags: Array<Vector3>,
      viewportRects: OrthoViewRects,
      maximumCapacity: number,
      layerMatrix: Matrix4x4,
      flycamMatrix: Matrix4x4,
    ) => {
      console.log("calling asyncGetMaximumZoomForAllMags");

      return asyncGetMaximumZoomForAllMags(
        viewMode,
        loadingStrategy,
        voxelSizeFactor,
        mags,
        viewportRects,
        maximumCapacity,
        layerMatrix,
        flycamMatrix,
      );
    },
  );
});

export default function* maintainMagRangesSaga(): Saga<void> {
  yield* call(ensureWkReady);
  const channel = yield* call(createStoreChannel);
  while (true) {
    const state: OxalisState = yield* take(channel);
    const layers = getDataLayers(state.dataset);

    for (const layer of layers) {
      const layerName = layer.name;

      const getZoomLevelsFn = yield* call(getComputeFunction, layerName);

      const { viewMode } = state.temporaryConfiguration;

      const layerMatrix = invertAndTranspose(
        getTransformsForLayer(
          state.dataset,
          layer,
          state.datasetConfiguration.nativelyRenderedLayerName,
        ).affineMatrix,
      );

      const dummyFlycamMatrix = _getDummyFlycamMatrix(state.dataset.dataSource.scale.factor);

      const zoomLevels = yield* call(
        getZoomLevelsFn,
        viewMode,
        state.datasetConfiguration.loadingStrategy,
        state.dataset.dataSource.scale.factor,
        getMagInfo(layer.resolutions).getDenseMags(),
        getViewportRects(state),
        Math.min(
          state.temporaryConfiguration.gpuSetup.smallestCommonBucketCapacity,
          constants.GPU_FACTOR_MULTIPLIER * state.userConfiguration.gpuMemoryFactor,
        ),
        layerMatrix,
        // Theoretically, the following parameter should be state.flycam.currentMatrix.
        // However, that matrix changes on each move which means that the ranges would need
        // to be recalculate on each move. At least, for orthogonal mode, the actual matrix
        // should only differ in its translation which can be ignored for gauging the maximum
        // zoom here.
        // However, for oblique and flight mode this is not really accurate. As a heuristic,
        // this already proved to be fine, though.
        dummyFlycamMatrix,
      );
      if (state.flycamInfoCache.magRangesPerLayer[layerName] !== zoomLevels) {
        yield* put(setMagRangeForLayerAction(layerName, zoomLevels));
      }
    }
  }
}

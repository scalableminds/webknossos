import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Matrix4x4 } from "mjs";
import type { OrthoViewRects, Vector3, ViewMode } from "oxalis/constants";
import constants from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call, select, take } from "oxalis/model/sagas/effect-generators";
import type { OxalisState } from "oxalis/store";
import type { LoadingStrategy } from "oxalis/store";
import AsyncGetMaximumZoomForAllMags from "oxalis/workers/async_get_maximum_zoom_for_all_mags.worker";
import { createWorker } from "oxalis/workers/comlink_wrapper";
import { actionChannel, put } from "typed-redux-saga";
import { getDataLayers, getMagInfo } from "../accessors/dataset_accessor";
import {
  getTransformsForLayer,
  invertAndTranspose,
} from "../accessors/dataset_layer_transformation_accessor";
import { _getDummyFlycamMatrix } from "../accessors/flycam_accessor";
import { getViewportRects } from "../accessors/view_mode_accessor";
import { setMaximumZoomForAllMagsForLayerAction } from "../actions/flycam_info_cache_actions";
import { ensureWkReady } from "./ready_sagas";
import { buffers } from "redux-saga";
import type { Action } from "../actions/actions";

const asyncGetMaximumZoomForAllMags = createWorker(AsyncGetMaximumZoomForAllMags);

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

export default function* maintainMaximumZoomForAllMagsSaga(): Saga<void> {
  // We use an actionChannel so that we don't miss new incoming actions
  // while waiting for the async computation of the last action.
  // We are only interested in the newest action, which is why we use
  // a sliding buffer of size 1.
  // We don't use takeLatest, because that would try to
  // abort a previous calculation (however, the webworker
  // would still complete its computation and the result value
  // can still be useful because the next computation
  // might be able to use the memoization result).
  const channel = yield actionChannel(
    [
      // These actions *might* affect the values of the parameters
      // that are given to getZoomLevelsFn. If they don't affect the
      // actual value, memoization will avoid recomputation.
      "SET_VIEW_MODE",
      "UPDATE_DATASET_SETTING",
      "UPDATE_USER_SETTING",
      "SET_DATASET",
      "SET_INPUT_CATCHER_RECT",
      "SET_INPUT_CATCHER_RECTS",
      "INITIALIZE_GPU_SETUP",
    ],
    buffers.sliding<Action>(1),
  );

  yield* call(ensureWkReady);
  while (true) {
    yield* take(channel);
    const state: OxalisState = yield* select((state) => state);
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
      if (state.flycamInfoCache.maximumZoomForAllMags[layerName] !== zoomLevels) {
        yield* put(setMaximumZoomForAllMagsForLayerAction(layerName, zoomLevels));
      }
    }
  }
}

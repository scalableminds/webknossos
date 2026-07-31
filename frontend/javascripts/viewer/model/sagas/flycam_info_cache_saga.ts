import memoize from "lodash-es/memoize";
import memoizeOne from "memoize-one";
import type { Matrix4x4 } from "mjs";
import { buffers } from "redux-saga";
import { actionChannel, delay, put } from "typed-redux-saga";
import type { OrthoViewRects, Vector3, ViewMode } from "viewer/constants";
import constants from "viewer/constants";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { call, select, take } from "viewer/model/sagas/effect_generators";
import type { LoadingStrategy, WebknossosState } from "viewer/store";
import { createWorker } from "viewer/workers/comlink_wrapper";
import type AsyncGetMaximumZoomForAllMags from "../../workers/async_get_maximum_zoom_for_all_mags.worker";
import { getDataLayers, getMagInfo } from "../accessors/dataset_accessor";
import {
  getTransformsForLayer,
  invertAndTranspose,
} from "../accessors/dataset_layer_transformation_accessor";
import {
  _getDummyFlycamMatrix,
  getBestZoomValueForFinestSharedMag,
} from "../accessors/flycam_accessor";
import { getViewportRects } from "../accessors/view_mode_accessor";
import type { Action } from "../actions/actions";
import { setZoomStepAction } from "../actions/flycam_actions";
import { setMaximumZoomForAllMagsForLayerAction } from "../actions/flycam_info_cache_actions";
import { ensureWkInitialized } from "./ready_sagas";

const asyncGetMaximumZoomForAllMags = createWorker<typeof AsyncGetMaximumZoomForAllMags>(
  "async_get_maximum_zoom_for_all_mags.worker.ts",
);

// The zoom ranges are computed asynchronously (in a webworker) whenever a relevant parameter,
// such as the viewport size, changed. Therefore, wait a bit after the last update to be
// reasonably sure that the recomputation for the current parameters finished.
// dataset_saga does the same for its downsampling warning.
const ZOOM_RANGES_SETTLE_DELAY = 500;

function hasEveryLayerMaxZoomInfoPresent(state: WebknossosState): boolean {
  return getDataLayers(state.dataset).every(
    (layer) => state.flycamInfoCache.maximumZoomForAllMags[layer.name] != null,
  );
}

function* waitUntilZoomRangesAreReady(): Saga<void> {
  // The zoom ranges are only meaningful once the viewports have their real size. Until
  // initializeInputCatcherSizes dispatches one of the following actions (which only happens
  // after the first render), inputCatcherRects still holds a placeholder rect.
  yield* take(["SET_INPUT_CATCHER_RECT", "SET_INPUT_CATCHER_RECTS"]);
  yield* delay(ZOOM_RANGES_SETTLE_DELAY);
  let doAllLayersHaveZoomInfo = yield* select(hasEveryLayerMaxZoomInfoPresent);
  while (!doAllLayersHaveZoomInfo) {
    yield* take("SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER");
    doAllLayersHaveZoomInfo = yield* select(hasEveryLayerMaxZoomInfoPresent);
  }
}

export function* adjustZoomToFinestSharedMagSaga(): Saga<void> {
  // Buffer the request, because it is dispatched at the end of the initialization (i.e., before
  // WK_INITIALIZED) and thus possibly before this saga reaches the take below.
  const requestChannel = yield* actionChannel(
    "ADJUST_ZOOM_TO_FINEST_SHARED_MAG",
    buffers.sliding<Action>(1),
  );
  yield* take(requestChannel);
  yield* call(waitUntilZoomRangesAreReady);

  const dataset = yield* select((state) => state.dataset);
  const maximumZoomForAllMags = yield* select(
    (state) => state.flycamInfoCache.maximumZoomForAllMags,
  );
  const zoomValue = yield* call(getBestZoomValueForFinestSharedMag, dataset, maximumZoomForAllMags);

  if (zoomValue != null) {
    yield* put(setZoomStepAction(zoomValue));
  }
}

const getComputeFunction = memoize((_layerName: string) => {
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
  const channel = yield* actionChannel(
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

  yield* call(ensureWkInitialized);
  while (true) {
    yield* take(channel);
    const state: WebknossosState = yield* select((state) => state);
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

      const dummyFlycamMatrix = _getDummyFlycamMatrix(state.dataset.dataSource.scale);

      const zoomLevels = yield* call(
        getZoomLevelsFn,
        viewMode,
        state.datasetConfiguration.loadingStrategy,
        state.dataset.dataSource.scale.factor,
        getMagInfo(layer.mags).getDenseMags(),
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
        // However, for flight mode this is not really accurate. As a heuristic,
        // this already proved to be fine, though.
        dummyFlycamMatrix,
      );
      if (state.flycamInfoCache.maximumZoomForAllMags[layerName] !== zoomLevels) {
        yield* put(setMaximumZoomForAllMagsForLayerAction(layerName, zoomLevels));
      }
    }
  }
}

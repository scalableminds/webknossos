import { call, put, take, takeEvery, takeLatest } from "typed-redux-saga";
import { sum } from "lodash";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { sleep } from "libs/utils";
import Toast from "libs/toast";
import messages from "messages";
import {
  getEnabledLayers,
  getLayerByName,
  getMaybeSegmentIndexAvailability,
  getResolutionInfo,
  getTransformsForLayer,
  invertAndTranspose,
  isLayerVisible,
} from "../accessors/dataset_accessor";
import { getCurrentResolution } from "../accessors/flycam_accessor";
import { getViewportExtents } from "../accessors/view_mode_accessor";
import { V3 } from "libs/mjs";
import { Identity4x4 } from "oxalis/constants";
import { hasSegmentIndex } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import {
  type EnsureSegmentIndexIsLoadedAction,
  setLayerHasSegmentIndexAction,
} from "../actions/dataset_actions";

export function* watchMaximumRenderableLayers(): Saga<void> {
  function* warnMaybe(): Saga<void> {
    const maximumLayerCountToRender = yield* select(
      (state) => state.temporaryConfiguration.gpuSetup.maximumLayerCountToRender,
    );
    const enabledLayerCount = yield* select(
      (state) => getEnabledLayers(state.dataset, state.datasetConfiguration).length,
    );

    if (enabledLayerCount > maximumLayerCountToRender) {
      Toast.error(
        messages["webgl.too_many_active_layers"]({
          maximumLayerCountToRender,
        }),
        {
          sticky: true,
          key: "TOO_MANY_ACTIVE_LAYERS",
        },
      );
    } else {
      Toast.close("TOO_MANY_ACTIVE_LAYERS");
    }
  }

  yield* takeEvery(["WK_READY", "UPDATE_LAYER_SETTING", "UPDATE_DATASET_SETTING"], warnMaybe);
}

let userClosedWarning = false;
export function* watchZ1Downsampling(): Saga<void> {
  function* maybeShowWarning(): Saga<void> {
    if (userClosedWarning) {
      return;
    }
    // In combination with `takeLatest` sleeping here at the beginning of the saga
    // effectively debounces the saga to avoid that it is executed unnecessarily often.
    yield* call(sleep, 200);

    const dataLayers = yield* select((state) => state.dataset.dataSource.dataLayers);

    let showWarning = false;
    const currentZoomStep = yield* select((state) => state.flycam.zoomStep);
    for (const dataLayer of dataLayers) {
      if (currentZoomStep < 1) {
        // If the user has zoomed into the data,
        // the rendering quality is expected to be relatively low.
        // Don't show any warnings in that case.
        break;
      }
      const isVisible = yield* select((state) => {
        return isLayerVisible(
          state.dataset,
          dataLayer.name,
          state.datasetConfiguration,
          state.temporaryConfiguration.viewMode,
        );
      });
      if (!isVisible) {
        continue;
      }

      let scaleX = 1;
      let scaleY = 1;
      const transformMatrix = yield* select(
        (state) =>
          getTransformsForLayer(
            state.dataset,
            dataLayer,
            state.datasetConfiguration.nativelyRenderedLayerName,
          ).affineMatrix,
      );
      if (transformMatrix !== Identity4x4) {
        const matrix = invertAndTranspose(transformMatrix);
        // A scale greater than 1 "shrinks" the data (effectively improving
        // the rendered quality as more voxels are used for rendering a region
        // than before).
        // See [1] for how the background on how to extract the scale from a matrix.
        // [1] https://math.stackexchange.com/questions/237369/given-this-transformation-matrix-how-do-i-decompose-it-into-translation-rotati
        scaleX = V3.length([matrix[0], matrix[4], matrix[8]]);
        scaleY = V3.length([matrix[1], matrix[5], matrix[9]]);
      }

      const currentRes = yield* select((state) => getCurrentResolution(state, dataLayer.name));
      if (currentRes == null) {
        // The layer cannot be rendered. For example, because the user zoomed out and there
        // is no appropriate mag for that layer.
        break;
      }
      const resolutionInfo = getResolutionInfo(dataLayer.resolutions);
      const bestExistingIndex = resolutionInfo.getFinestResolutionIndex();
      const currentIndex = resolutionInfo.getIndexByResolution(currentRes);
      if (currentIndex <= bestExistingIndex) {
        // There's no better mag to render the current layer in.
        continue;
      }

      const minVoxelPerPixel = 0.1;
      const extents = yield* select((state) => getViewportExtents(state));
      const areas = [extents.PLANE_XY, extents.PLANE_YZ, extents.PLANE_XZ].map(
        ([width, height]) => width * height,
      );
      const areDataviewportsInvisible = sum(areas) === 0;

      // Check only the downsampled dimensions x and y
      showWarning =
        ((currentZoomStep / currentRes[0]) * scaleX < minVoxelPerPixel ||
          (currentZoomStep / currentRes[1]) * scaleY < minVoxelPerPixel) &&
        !areDataviewportsInvisible;

      if (showWarning) {
        break;
      }
    }
    if (showWarning) {
      Toast.warning(messages["dataset.z1_downsampling_hint"], {
        sticky: true,
        key: "DOWNSAMPLING_CAUSES_BAD_QUALITY",
        onClose: () => {
          userClosedWarning = true;
        },
      });
    } else {
      Toast.close("DOWNSAMPLING_CAUSES_BAD_QUALITY");
    }
  }
  yield* take("WK_READY");
  yield* call(maybeShowWarning);
  yield* takeLatest(
    ["ZOOM_IN", "ZOOM_OUT", "ZOOM_BY_DELTA", "SET_ZOOM_STEP", "SET_STORED_LAYOUTS"],
    maybeShowWarning,
  );
}

export function* ensureSegmentIndexIsLoaded(): Saga<void> {
  function* maybeFetchHasSegmentIndex(action: EnsureSegmentIndexIsLoadedAction): Saga<void> {
    const { layerName } = action;
    const dataset = yield* select((state) => state.dataset);
    if (layerName == null) return;
    const segmentationLayer = yield* call(getLayerByName, dataset, layerName);
    const maybeIsSegmentIndexAvailable = yield* call(
      getMaybeSegmentIndexAvailability,
      dataset,
      layerName,
    );
    if (maybeIsSegmentIndexAvailable == null && segmentationLayer != null) {
      const tracing = yield* select((state) => state.tracing);
      const updatedIsSegmentIndexAvailable = yield* call(
        hasSegmentIndex,
        segmentationLayer,
        dataset,
        tracing,
      );
      yield* put(
        setLayerHasSegmentIndexAction(segmentationLayer.name, updatedIsSegmentIndexAvailable),
      );
    }
  }
  yield* takeEvery("ENSURE_SEGMENT_INDEX_IS_LOADED", maybeFetchHasSegmentIndex);
}

export default [watchMaximumRenderableLayers, watchZ1Downsampling, ensureSegmentIndexIsLoaded];

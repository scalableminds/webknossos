import ErrorHandling from "libs/error_handling";

import features from "features";
import Toast from "libs/toast";
import {
  ComputeQuickSelectForRectAction,
  ComputeSAMForSkeletonAction,
  MaybePrefetchEmbeddingAction,
} from "oxalis/model/actions/volumetracing_actions";
import { Saga, select } from "oxalis/model/sagas/effect-generators";
import { all, call, put, takeEvery, takeLatest } from "typed-redux-saga";

import createProgressCallback from "libs/progress_callback";
import { AnnotationToolEnum, BoundingBoxType, Vector3 } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { Tree } from "oxalis/store";
import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";
import { getActiveSegmentationTracingLayer } from "../accessors/volumetracing_accessor";
import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../actions/ui_actions";
import BoundingBox from "../bucket_data_handling/bounding_box";
import performQuickSelectHeuristic, { prepareQuickSelect } from "./quick_select_heuristic_saga";
import performQuickSelectML, {
  SAMNodeSelect,
  getInferenceSession,
  prefetchEmbedding,
} from "./quick_select_ml_saga";
import { performVolumeInterpolation } from "./volume/volume_interpolation_saga";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

const SKELETON_SAM_PREDICTION_BOUNDS = 300;

type SkeletonSamPrediction = {
  saga: Saga<void>;
  bounds: BoundingBoxType;
};

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    ["COMPUTE_QUICK_SELECT_FOR_RECT", "COMPUTE_SAM_FOR_SKELETON"],
    function* guard(action: ComputeQuickSelectForRectAction | ComputeSAMForSkeletonAction) {
      try {
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

          yield* put(setQuickSelectStateAction("active"));
          if (yield* call(shouldUseHeuristic)) {
            yield* call(performQuickSelectHeuristic, action);
          } else {
            yield* call(performQuickSelectML, action);
          }
        } else {
          const tree: Tree = yield* select(
            (state) => enforceSkeletonTracing(state.tracing).trees[action.treeId],
          );
          const activeViewport = action.viewport;
          const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

          if (busyBlockingInfo.isBusy) {
            console.warn(
              `Ignoring skelton SAM annotation request (reason: ${
                busyBlockingInfo.reason || "unknown"
              })`,
            );
            return;
          }

          yield* put(setBusyBlockingInfoAction(true, "Annotating nodes of Tree ..."));
          const progressCallback = createProgressCallback({
            pauseDelay: 200,
            successMessageDelay: 1000,
            key: "TREE_SAM_ANNOTATION_PROGRESS",
          });
          const preparation = yield* call(prepareQuickSelect, action);
          if (preparation == null) {
            return;
          }
          const {
            labeledZoomStep,
            firstDim,
            secondDim,
            thirdDim,
            labeledResolution,
            volumeTracing,
          } = preparation;
          function* interpolateBetweenPredictions(
            predictFirstSlice: SkeletonSamPrediction,
            predictSecondSlice: SkeletonSamPrediction,
          ): Saga<void> {
            // First wait for the predictions between which this saga should interpolate.
            yield* all([predictFirstSlice.saga, predictSecondSlice.saga]);
            const volumeTracingLayer = yield* select((store) =>
              getActiveSegmentationTracingLayer(store),
            );
            if (volumeTracingLayer == null) {
              return;
            }
            const interpolationBoxMag1 = new BoundingBox(predictFirstSlice.bounds).extend(
              new BoundingBox(predictSecondSlice.bounds),
            );
            const interpolationDepth = interpolationBoxMag1.getSize()[thirdDim];
            const directionFactor = Math.sign(
              predictFirstSlice.bounds.min[thirdDim] - predictSecondSlice.bounds.min[thirdDim],
            );
            // Add one to the max of the thirdDim to include the last slice in the data being loaded during the interpolation.
            interpolationBoxMag1.max[thirdDim] += 1;

            // Now interpolate between the two predictions.
            yield* call(
              performVolumeInterpolation,
              volumeTracing,
              volumeTracingLayer,
              activeViewport,
              interpolationBoxMag1,
              labeledResolution,
              labeledZoomStep,
              interpolationDepth,
              directionFactor,
              false,
            );
          }
          let previousPrediction: SkeletonSamPrediction | null = null;
          const interpolationSagas = [];
          for (const node of tree.nodes.values()) {
            const nodePosition: Vector3 = [...node.position];
            const embeddingPrefetchTopLeft: Vector3 = [...node.position];
            const embeddingPrefetchBottomRight: Vector3 = [...node.position];
            embeddingPrefetchTopLeft[firstDim] -= SKELETON_SAM_PREDICTION_BOUNDS;
            embeddingPrefetchTopLeft[secondDim] -= SKELETON_SAM_PREDICTION_BOUNDS;
            embeddingPrefetchBottomRight[firstDim] += SKELETON_SAM_PREDICTION_BOUNDS;
            embeddingPrefetchBottomRight[secondDim] += SKELETON_SAM_PREDICTION_BOUNDS;
            const prefetchBounds = {
              min: embeddingPrefetchTopLeft,
              max: embeddingPrefetchBottomRight,
            };
            const nodeSelect: SAMNodeSelect = {
              nodePosition,
              bounds: prefetchBounds,
              viewport: activeViewport,
            };
            const currentPredictionSaga = call(performQuickSelectML, nodeSelect);
            const currentPrediction = { saga: currentPredictionSaga, bounds: prefetchBounds };
            if (previousPrediction) {
              const isTooCloseToPreviousPrediction =
                Math.abs(previousPrediction.bounds.max[thirdDim] - prefetchBounds.min[thirdDim]) <
                2;
              if (!isTooCloseToPreviousPrediction) {
                interpolationSagas.push(
                  call(interpolateBetweenPredictions, currentPrediction, previousPrediction),
                );
              }
            }
            previousPrediction = currentPrediction;
          }
          yield* all([...interpolationSagas]);
          yield* call(progressCallback, true, "Finished annotating all nodes");
        }
      } catch (ex) {
        Toast.error((ex as Error).toString());
        ErrorHandling.notify(ex as Error);
        console.error(ex);
      } finally {
        yield* put(setBusyBlockingInfoAction(false));
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          action?.quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
        }
        yield* put(setQuickSelectStateAction("inactive"));
      }
    },
  );

  yield* takeLatest(
    "MAYBE_PREFETCH_EMBEDDING",
    function* guard(action: MaybePrefetchEmbeddingAction) {
      const useHeuristic = yield* call(shouldUseHeuristic);
      if (!useHeuristic) {
        yield* call(prefetchEmbedding, action);
      }
    },
  );

  yield* takeEvery(["SET_TOOL", "CYCLE_TOOL"], function* guard() {
    const isQuickSelectTool = yield* select(
      (state) => state.uiInformation.activeTool === AnnotationToolEnum.QUICK_SELECT,
    );
    if (isQuickSelectTool && features().segmentAnythingEnabled) {
      // Retrieve the inference session to prefetch it as soon as the tool
      // is selected. If the session is cached, this is basically a noop.
      yield* call(getInferenceSession);
    }
  });

  yield* takeEvery("ESCAPE", function* handler() {
    if (yield* select((state) => state.uiInformation.quickSelectState === "drawing")) {
      // The user hit escape and the quick select mode should be canceled.
      // Escaping the preview mode is handled within the quick select sagas that support
      // preview mode (currently only the non-ml variant).
      yield* put(setQuickSelectStateAction("inactive"));
      const quickSelectGeometry = yield* call(() => getSceneController().quickSelectGeometry);
      quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);
    }
  });
}

import features from "features";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import _ from "lodash";
import {
  type ComputeQuickSelectForRectAction,
  type ComputeSAMForSkeletonAction,
  type MaybePrefetchEmbeddingAction,
  finishAnnotationStrokeAction,
} from "oxalis/model/actions/volumetracing_actions";
import { type Saga, select } from "oxalis/model/sagas/effect-generators";
import { all, call, put, takeEvery, takeLatest } from "typed-redux-saga";

import type { BoundingBoxType, OrthoView, Vector3 } from "oxalis/constants";
import { AnnotationToolEnum } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import type { Node, VolumeTracing } from "oxalis/store";
import type { Tree } from "oxalis/store";
import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";
import { getActiveSegmentationTracingLayer } from "../accessors/volumetracing_accessor";
import { setBusyBlockingInfoAction, setQuickSelectStateAction } from "../actions/ui_actions";
import BoundingBox from "../bucket_data_handling/bounding_box";
import performQuickSelectHeuristic, { prepareQuickSelect } from "./quick_select_heuristic_saga";
import performQuickSelectML, {
  EMBEDDING_SIZE,
  type SAMNodeSelect,
  getInferenceSession,
  prefetchEmbedding,
} from "./quick_select_ml_saga";
import {
  showAndGetSkeletonQuickSelectInfoComponents,
  showFollowupInterpolationToast,
  getSkeletonQuickSelectModalContent,
} from "./skeleton_quick_select_info_components";
import { performVolumeInterpolation } from "./volume/volume_interpolation_saga";
import { getActiveSegmentationTracing } from "../accessors/volumetracing_accessor";
import { ensureMaybeActiveMappingIsLocked } from "./saga_helpers";

function* shouldUseHeuristic() {
  const useHeuristic = yield* select((state) => state.userConfiguration.quickSelect.useHeuristic);
  return useHeuristic || !features().segmentAnythingEnabled;
}

function prepareSkeletonSAMInput(
  nodes: Node[],
  dimensions: Vector3,
  activeViewport: OrthoView,
  predictionFinishedCallback: () => void,
): SAMNodeSelect {
  const [firstDim, secondDim, _thirdDim] = dimensions;
  const nodePositions = nodes.map((node) => node.untransformedPosition);
  const sum = nodePositions.reduce((currentSum: Vector3, position: Vector3) => {
    return currentSum.map((sum, index) => sum + position[index]) as Vector3;
  });
  const center = sum.map((sum) => sum / nodePositions.length) as Vector3;
  const embeddingPrefetchTopLeft: Vector3 = [...center];
  const embeddingPrefetchBottomRight: Vector3 = [...center];
  embeddingPrefetchTopLeft[firstDim] -= EMBEDDING_SIZE[0] / 2;
  embeddingPrefetchTopLeft[secondDim] -= EMBEDDING_SIZE[1] / 2;
  embeddingPrefetchBottomRight[firstDim] += EMBEDDING_SIZE[0] / 2;
  embeddingPrefetchBottomRight[secondDim] += EMBEDDING_SIZE[1] / 2;

  const prefetchBounds = {
    min: embeddingPrefetchTopLeft,
    max: embeddingPrefetchBottomRight,
  };
  const nodeSelect: SAMNodeSelect = {
    nodePositions,
    bounds: prefetchBounds,
    viewport: activeViewport,
    predictionFinishedCallback,
  };
  return nodeSelect;
}

function* interpolateBetweenPredictions(
  firstPredictedSliceBounds: BoundingBoxType,
  secondPredictedSliceBounds: BoundingBoxType,
  volumeTracing: VolumeTracing,
  activeViewport: OrthoView,
  thirdDim: number,
  labeledResolution: Vector3,
  labeledZoomStep: number,
): Saga<void> {
  // First wait for the predictions between which this saga should interpolate.
  const volumeTracingLayer = yield* select((store) => getActiveSegmentationTracingLayer(store));
  if (volumeTracingLayer == null) {
    return;
  }
  const interpolationBoxMag1 = new BoundingBox(firstPredictedSliceBounds).extend(
    new BoundingBox(secondPredictedSliceBounds),
  );
  const interpolationDepth = interpolationBoxMag1.getSize()[thirdDim];
  const directionFactor = Math.sign(
    firstPredictedSliceBounds.min[thirdDim] - secondPredictedSliceBounds.min[thirdDim],
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

type QuickSelectPreparationParameter = {
  labeledZoomStep: number;
  labeledResolution: Vector3;
  firstDim: number;
  secondDim: number;
  thirdDim: number;
  volumeTracing: VolumeTracing;
  activeViewport: OrthoView;
  predictionFinishedCallback: () => void;
};

function prepareSkeletonSAMPredictions(
  nodePositionsGroupedBySlice: Record<number, Node[]>,
  options: QuickSelectPreparationParameter,
) {
  let previousPredictionBounds: BoundingBoxType | null = null;
  const samPredictions = [];
  const interpolationSagas = [];
  const {
    volumeTracing,
    activeViewport,
    labeledZoomStep,
    labeledResolution,
    firstDim,
    secondDim,
    thirdDim,
    predictionFinishedCallback,
  } = options;
  for (const nodesOfASingleSlice of Object.values(nodePositionsGroupedBySlice) as Node[][]) {
    const nodeQuickSelectInput = prepareSkeletonSAMInput(
      nodesOfASingleSlice,
      [firstDim, secondDim, thirdDim],
      activeViewport,
      predictionFinishedCallback,
    );
    const currentPredictionSaga = call(performQuickSelectML, nodeQuickSelectInput);
    samPredictions.push(currentPredictionSaga);
    const currentPredictionBounds = nodeQuickSelectInput.bounds;
    if (previousPredictionBounds) {
      const isTooCloseToPreviousPrediction =
        Math.abs(previousPredictionBounds.max[thirdDim] - currentPredictionBounds.min[thirdDim]) <
        2;
      if (!isTooCloseToPreviousPrediction) {
        interpolationSagas.push(
          call(
            interpolateBetweenPredictions,
            currentPredictionBounds,
            previousPredictionBounds,
            volumeTracing,
            activeViewport,
            thirdDim,
            labeledResolution,
            labeledZoomStep,
          ),
        );
      }
    }
    previousPredictionBounds = currentPredictionBounds;
  }
  return { samPredictions, interpolationSagas };
}

function getPredictionFinishedCallback() {
  let counter = 0;
  let maximum = 1;
  let updateModal = (_a: React.ReactNode) => {};
  const setUpdateModal = (update: typeof updateModal) => (updateModal = update);
  const setPredictionCount = (count: number) => (maximum = count);
  const predictionFinishedCallback = () => {
    counter++;
    const newModalContent = getSkeletonQuickSelectModalContent((counter / maximum) * 100);
    updateModal(newModalContent);
  };
  return { predictionFinishedCallback, setPredictionCount, setUpdateModal };
}

function* performSkeletonQuickSelectSAM(action: ComputeSAMForSkeletonAction) {
  const tree: Tree = yield* select(
    (state) => enforceSkeletonTracing(state.tracing).trees[action.treeId],
  );
  const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

  if (busyBlockingInfo.isBusy) {
    console.warn(
      `Ignoring skelton SAM annotation request (reason: ${busyBlockingInfo.reason || "unknown"})`,
    );
    return;
  }

  yield* put(setBusyBlockingInfoAction(true, "Annotating nodes of Tree with SAM ..."));
  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const activeViewport = action.viewport;
  const { labeledZoomStep, firstDim, secondDim, thirdDim, labeledResolution, volumeTracing } =
    preparation;

  const getNodesThirdDimSlice = (node: Node) => node.untransformedPosition[thirdDim];
  const nodePositionsGroupedBySlice = _.groupBy(
    _.sortBy([...tree.nodes.values()], getNodesThirdDimSlice),
    getNodesThirdDimSlice,
  ) as Record<number, Node[]>;

  const { predictionFinishedCallback, setPredictionCount, setUpdateModal } =
    getPredictionFinishedCallback();
  const options = {
    labeledZoomStep,
    labeledResolution,
    firstDim,
    secondDim,
    thirdDim,
    volumeTracing,
    activeViewport,
    predictionFinishedCallback,
  };

  const { samPredictions, interpolationSagas } = prepareSkeletonSAMPredictions(
    nodePositionsGroupedBySlice,
    options,
  );
  setPredictionCount(samPredictions.length);
  const modal = showAndGetSkeletonQuickSelectInfoComponents();
  setUpdateModal((newContent: React.ReactNode) => modal.update({ content: newContent }));

  yield* all(samPredictions);
  yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
  yield* put(setBusyBlockingInfoAction(false));
  modal.update({
    okButtonProps: { disabled: false },
    okText: "Proceed with correcting the selections",
  });
  const shouldPerformInterpolation = yield* call(showFollowupInterpolationToast);
  if (shouldPerformInterpolation) {
    yield* put(setBusyBlockingInfoAction(true, "Interpolating between SAM predictions ..."));
    yield* all(interpolationSagas);
    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
    yield* put(setBusyBlockingInfoAction(false));
  }
}

export default function* listenToQuickSelect(): Saga<void> {
  yield* takeEvery(
    ["COMPUTE_QUICK_SELECT_FOR_RECT", "COMPUTE_SAM_FOR_SKELETON"],
    function* guard(action: ComputeQuickSelectForRectAction | ComputeSAMForSkeletonAction) {
      try {
        if (action.type === "COMPUTE_QUICK_SELECT_FOR_RECT") {
          const volumeTracing: VolumeTracing | null | undefined = yield* select(
            getActiveSegmentationTracing,
          );
          if (volumeTracing) {
            // As changes to the volume layer will be applied, the potentially existing mapping should be locked to ensure a consistent state.
            const { isMappingLockedIfNeeded } = yield* call(
              ensureMaybeActiveMappingIsLocked,
              volumeTracing,
            );
            if (!isMappingLockedIfNeeded) {
              return;
            }
          }
          yield* put(setBusyBlockingInfoAction(true, "Selecting segment"));

          yield* put(setQuickSelectStateAction("active"));
          if (yield* call(shouldUseHeuristic)) {
            yield* call(performQuickSelectHeuristic, action);
          } else {
            yield* call(performQuickSelectML, action);
          }
        } else {
          yield* call(performSkeletonQuickSelectSAM, action);
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

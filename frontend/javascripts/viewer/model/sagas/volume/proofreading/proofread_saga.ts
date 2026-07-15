import Toast from "libs/toast";
import { SoftError } from "libs/utils";
import messages from "messages";
import { call, put, takeEvery } from "typed-redux-saga";
import { OrthoViews, TreeTypeEnum } from "viewer/constants";
import { getSegmentIdForPositionAsync } from "viewer/controller/combinations/volume_handlers";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  enforceSkeletonTracing,
  getTreeAndNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getActiveUnmappedSegmentId,
} from "viewer/model/accessors/volumetracing_accessor";
import { removeMeshAction } from "viewer/model/actions/annotation_actions";
import {
  type ProofreadAtPositionAction,
  resetMultiCutToolPartitionsAction,
  type ToggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import type { UpdateUserSettingAction } from "viewer/model/actions/settings_actions";
import type {
  CreateNodeAction,
  DeleteNodeAction,
  SetNodePositionAction,
} from "viewer/model/actions/skeletontracing_actions";
import type { EscapeAction } from "viewer/model/actions/ui_actions";
import {
  setActiveCellAction,
  updateProofreadingMarkerPositionAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { getAdditionalCoordinatesAsString } from "../../../accessors/flycam_accessor";
import { ensureWkInitialized } from "../../ready_sagas";
import { takeEveryInOperationContext, takeWithBatchActionSupport } from "../../saga_helpers";
import { ensureHdf5MappingIsEnabled } from "./preparation_sagas";
import {
  handleMinCutAgglomerate,
  handleProofreadCutFromNeighbors,
  handleProofreadMerge,
  performPartitionedMinCut,
} from "./proofread_action_handler_sagas";
import { ensureSegmentItemAndMaybeLoadCoarseMesh } from "./segment_and_mesh_refresh_sagas";
import { handleMergeViaTree, handleSplitViaTree } from "./tree_proofreading_sagas";

function runSagaAndCatchSoftError<T>(saga: (...args: any[]) => Saga<T>) {
  return function* (...args: any[]) {
    try {
      yield* call(saga, ...args);
    } catch (exception) {
      if (exception instanceof SoftError) {
        yield* call([Toast, Toast.warning], exception.message);
        return;
      }
      throw exception;
    }
  };
}

const PROOFREADING_BUSY_REASON = "Proofreading in progress";

export default function* proofreadRootSaga(): Saga<void> {
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* call(ensureWkInitialized);
  const proofreadingOptions = {
    id: "PROOFREADING" as const,
    description: PROOFREADING_BUSY_REASON,
  };

  yield* takeEveryInOperationContext(
    "MERGE_TREES",
    runSagaAndCatchSoftError(handleMergeViaTree),
    proofreadingOptions,
  );
  yield* takeEveryInOperationContext(
    ["DELETE_EDGE", "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS"],
    runSagaAndCatchSoftError(handleSplitViaTree),
    proofreadingOptions,
  );
  yield* takeEvery(["PROOFREAD_AT_POSITION"], runSagaAndCatchSoftError(proofreadAtPosition));
  yield* takeEvery(
    ["CLEAR_PROOFREADING_BY_PRODUCTS"],
    runSagaAndCatchSoftError(clearProofreadingByproducts),
  );
  yield* takeEveryInOperationContext(
    "PROOFREAD_MERGE",
    runSagaAndCatchSoftError(handleProofreadMerge),
    proofreadingOptions,
  );
  yield* takeEveryInOperationContext(
    "MIN_CUT_AGGLOMERATE",
    runSagaAndCatchSoftError(handleMinCutAgglomerate),
    proofreadingOptions,
  );
  yield* takeEveryInOperationContext(
    ["MIN_CUT_PARTITIONS", "ENTER"],
    runSagaAndCatchSoftError(performPartitionedMinCut),
    proofreadingOptions,
  );
  yield* takeEveryInOperationContext(
    ["CUT_AGGLOMERATE_FROM_NEIGHBORS"],
    runSagaAndCatchSoftError(handleProofreadCutFromNeighbors),
    proofreadingOptions,
  );

  yield* takeEvery(
    ["CREATE_NODE", "DELETE_NODE", "SET_NODE_POSITION"],
    runSagaAndCatchSoftError(checkForAgglomerateTreeModification),
  );
  yield* takeEvery(["UPDATE_USER_SETTING", "ESCAPE"], clearMinCutPartitionsOnMultiCutDeselect);
  yield* takeEvery(["ESCAPE"], clearActiveSegmentIfTdViewportIsActive);
  yield* takeEvery("TOGGLE_SEGMENT_IN_PARTITION", showToastIfSegmentOfOtherAgglomerateWasSelected);
}

function* clearMinCutPartitionsOnMultiCutDeselect(
  action: UpdateUserSettingAction | EscapeAction,
): Saga<void> {
  if (action.type === "UPDATE_USER_SETTING" && action.propertyName === "isMultiSplitActive") {
    const newIsMultiSplitActiveState = yield* select(
      (state) => state.userConfiguration.isMultiSplitActive,
    );
    if (!newIsMultiSplitActiveState) {
      yield* put(resetMultiCutToolPartitionsAction());
    } else {
      // Deactivate current active super voxel to avoid tri-state highlighting (only partition one and two highlighting should be active)
      const sceneController = getSceneController();
      const { segmentMeshController } = sceneController;
      segmentMeshController.updateActiveUnmappedSegmentIdHighlighting(null);
    }
  } else if (action.type === "ESCAPE") {
    // Clearing on all escape actions should be fine as in case the multi split isn't active, this clearing should also be fine.
    yield* put(resetMultiCutToolPartitionsAction());
  }
}

function* clearActiveSegmentIfTdViewportIsActive(): Saga<void> {
  // Clearing on all escape actions should be fine as in case the multi split isn't active, this clearing should also be fine.
  const activeViewport = yield* select((state) => state.viewModeData.plane.activeViewport);
  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  const activeVolumeTracing = yield* select(getActiveSegmentationTracing);
  const activeUnmappedSegmentId = yield* select((state) =>
    getActiveUnmappedSegmentId(state, activeVolumeTracing),
  );
  const hasHighlightedSuperVoxel =
    activeVolumeTracing?.activeCellId != null && activeUnmappedSegmentId != null;
  if (
    hasHighlightedSuperVoxel &&
    activeTool === AnnotationTool.PROOFREAD &&
    activeViewport === OrthoViews.TDView
  ) {
    yield* put(setActiveCellAction(activeVolumeTracing?.activeCellId, undefined, undefined, null));
  }
}

function* showToastIfSegmentOfOtherAgglomerateWasSelected(
  action: ToggleSegmentInPartitionAction,
): Saga<void> {
  const visibleSegmentationLayer = yield* select((state) => getVisibleSegmentationLayer(state));
  const layerName = visibleSegmentationLayer?.name;
  if (!layerName) {
    return;
  }
  const layerData = yield* select((state) => state.localSegmentationStateByLayer[layerName]);
  if (!layerData || !layerData.minCutPartitions) {
    return;
  }
  const minCutPartitions = layerData.minCutPartitions;
  if (
    minCutPartitions.agglomerateId != null &&
    minCutPartitions.agglomerateId !== action.agglomerateId
  ) {
    Toast.info(messages["proofreading.multi_cut.different_agglomerate_selected"]);
  }
}

function* checkForAgglomerateTreeModification(
  action: CreateNodeAction | DeleteNodeAction | SetNodePositionAction,
): Saga<void> {
  let nodeId, treeId;

  if (action.type === "CREATE_NODE") {
    ({ treeId } = action);
  } else {
    ({ nodeId, treeId } = action);
  }

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));

  if (getTreeAndNode(skeletonTracing, nodeId, treeId, TreeTypeEnum.AGGLOMERATE)) {
    Toast.warning(
      "Agglomerate trees can only be modified when using the proofreading tool to add or delete edges. Consider switching to the proofreading tool or converting the agglomerate tree to a normal tree via right-click in the Skeleton tab.",
      { timeout: 10000 },
    );
  }
}

function* proofreadAtPosition(action: ProofreadAtPositionAction): Saga<void> {
  const { position, additionalCoordinates } = action;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const layerName = volumeTracingLayer.tracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled || volumeTracing.mappingName == null) return;

  yield put(updateProofreadingMarkerPositionAction(position, layerName));

  const segmentId = yield* call(getSegmentIdForPositionAsync, position);

  /* Load a coarse mesh of the agglomerate at the click position */
  yield* call(
    ensureSegmentItemAndMaybeLoadCoarseMesh,
    layerName,
    segmentId,
    position,
    additionalCoordinates,
  );
}

function* clearProofreadingByproducts() {
  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const layerName = volumeTracingLayer.tracingId;

  const additionalCoordinateKey = yield* select((state) =>
    getAdditionalCoordinatesAsString(state.flycam.additionalCoordinates),
  );
  const meshInfos =
    (yield* select(
      (state) => state.localSegmentationStateByLayer[layerName]?.meshes?.[additionalCoordinateKey],
    )) || {};
  const meshRemoveActions = Object.values(meshInfos).map((meshInfo) => {
    return removeMeshAction(layerName, meshInfo.segmentId);
  });
  for (const action of meshRemoveActions) {
    yield* put(action);
  }
}
